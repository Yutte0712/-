import { useState, useEffect, useRef } from 'react';

function App() {
  const [medals, setMedals] = useState(100);
  const [isRouletteSpinning, setIsRouletteSpinning] = useState(false);
  const [rouletteNumber, setRouletteNumber] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  // レール上の位置を追跡するための型
  interface RailPosition {
    railIndex: number;
    progress: number; // 0から1の間の値
    friction?: number; // 摩擦係数（オプション）
  }

  // レールの制御点を定義する型
  interface ControlPoint {
    x: number;
    y: number;
    controlX?: number;
    controlY?: number;
  }

  // レールの定義
  interface Rail {
    points: ControlPoint[];
    type: 'entry' | 'main' | 'collection';
    multiplier?: number; // Collection area score multiplier
  }

  // スコアの状態を追加
  const [score, setScore] = useState(0)
  const [lastCollected, setLastCollected] = useState<{
    position: { x: number, y: number },
    points: number,
    timestamp: number
  } | null>(null)

  // レールの定義配列（マルチプライヤー付き）
  const rails: Rail[] = [
    // 左側のエントリーレール
    {
      type: 'entry',
      points: [
        { x: 160, y: 80 },
        { x: 200, y: 160, controlX: 160, controlY: 120 },
        { x: 240, y: 240, controlX: 220, controlY: 200 }
      ]
    },
    // 中央のエントリーレール
    {
      type: 'entry',
      points: [
        { x: 400, y: 80 },
        { x: 400, y: 160, controlX: 400, controlY: 120 },
        { x: 400, y: 240, controlX: 400, controlY: 200 }
      ]
    },
    // 右側のエントリーレール
    {
      type: 'entry',
      points: [
        { x: 640, y: 80 },
        { x: 600, y: 160, controlX: 640, controlY: 120 },
        { x: 560, y: 240, controlX: 580, controlY: 200 }
      ]
    },
    // メインの曲線レール（左）
    {
      type: 'main',
      points: [
        { x: 240, y: 240 },
        { x: 200, y: 320, controlX: 220, controlY: 280 },
        { x: 160, y: 480, controlX: 180, controlY: 400 }
      ]
    },
    // メインの曲線レール（中央）
    {
      type: 'main',
      points: [
        { x: 400, y: 240 },
        { x: 400, y: 320, controlX: 400, controlY: 280 },
        { x: 400, y: 480, controlX: 400, controlY: 400 }
      ]
    },
    // メインの曲線レール（右）
    {
      type: 'main',
      points: [
        { x: 560, y: 240 },
        { x: 600, y: 320, controlX: 580, controlY: 280 },
        { x: 640, y: 480, controlX: 620, controlY: 400 }
      ]
    },
    // コレクションエリア（左: ハイリスク・ハイリターン）
    {
      type: 'collection',
      points: [
        { x: 160, y: 480 },
        { x: 160, y: 520, controlX: 160, controlY: 500 }
      ],
      multiplier: 3 // 3倍スコア
    },
    // コレクションエリア（中央: 標準）
    {
      type: 'collection',
      points: [
        { x: 400, y: 480 },
        { x: 400, y: 520, controlX: 400, controlY: 500 }
      ],
      multiplier: 1 // 標準スコア
    },
    // コレクションエリア（右: ローリスク・ローリターン）
    {
      type: 'collection',
      points: [
        { x: 640, y: 480 },
        { x: 640, y: 520, controlX: 640, controlY: 500 }
      ],
      multiplier: 2 // 2倍スコア
    }
  ];

  // ゲームオブジェクトの型定義を更新
  interface GameObject {
    x: number;
    y: number;
    type: 'medal' | 'ball';
    velocityX: number;
    velocityY: number;
    angle?: number;
    speed?: number;
    onRail?: RailPosition & {
      lastProgress?: number;
      entryTime?: number;
    };
  }

  const [gameObjects, setGameObjects] = useState<GameObject[]>([]);
  const pusherRef = useRef({ position: 0, direction: 1, speed: 2 });

  // レール上の点を計算する関数
  const getPointOnRail = (rail: Rail, progress: number): { x: number; y: number } => {
    const points = rail.points;
    if (points.length < 2) return points[0];
    
    // 2点間の補間
    const segment = Math.floor(progress * (points.length - 1));
    const segmentProgress = (progress * (points.length - 1)) % 1;
    
    const p1 = points[segment];
    const p2 = points[segment + 1];
    
    if (!p2) return p1;
    
    // ベジェ曲線の計算
    if (p1.controlX !== undefined && p1.controlY !== undefined) {
      const cp1x = p1.controlX;
      const cp1y = p1.controlY;
      const cp2x = p2.controlX ?? p2.x;
      const cp2y = p2.controlY ?? p2.y;
      
      const t = segmentProgress;
      const mt = 1 - t;
      
      return {
        x: mt * mt * mt * p1.x + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * p2.x,
        y: mt * mt * mt * p1.y + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * p2.y
      };
    }
    
    // 直線補間
    return {
      x: p1.x + (p2.x - p1.x) * segmentProgress,
      y: p1.y + (p2.y - p1.y) * segmentProgress
    };
  };

  useEffect(() => {
    if (!canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number

    const updatePhysics = () => {
      setGameObjects(prevObjects => {
        // オブジェクト同士の衝突判定
        const objects = [...prevObjects] as GameObject[]
        for (let i = 0; i < objects.length; i++) {
          for (let j = i + 1; j < objects.length; j++) {
            // レール上のオブジェクトは衝突判定しない
            if (objects[i]?.onRail || objects[j]?.onRail) continue;
            
            const obj1 = objects[i]
            const obj2 = objects[j]
            const dx = obj2.x - obj1.x
            const dy = obj2.y - obj1.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            const minDistance = (obj1.type === 'medal' ? 10 : 8) + (obj2.type === 'medal' ? 10 : 8)
            
            if (distance < minDistance) {
              // 衝突時の反発
              const angle = Math.atan2(dy, dx)
              const overlap = minDistance - distance
              
              // オブジェクトを離す
              objects[i].x -= (overlap / 2) * Math.cos(angle)
              objects[i].y -= (overlap / 2) * Math.sin(angle)
              objects[j].x += (overlap / 2) * Math.cos(angle)
              objects[j].y += (overlap / 2) * Math.sin(angle)
              
              // 速度の交換（反発係数0.5）
              const tempVX = objects[i].velocityX
              const tempVY = objects[i].velocityY
              objects[i].velocityX = objects[j].velocityX * 0.5
              objects[i].velocityY = objects[j].velocityY * 0.5
              objects[j].velocityX = tempVX * 0.5
              objects[j].velocityY = tempVY * 0.5
            }
          }
        }
        
        // 物理演算の更新
        const updatedObjects = objects.map(obj => {
          // レール上のオブジェクトの更新
          if (obj.onRail) {
            const rail = rails[obj.onRail.railIndex];
            const baseSpeed = 0.005; // 基本速度
            const speedMultiplier = obj.type === 'ball' ? 1.2 : 1.0; // ボールは少し速く
            const friction = obj.onRail.friction ?? 1.0; // 摩擦係数
            const speed = baseSpeed * speedMultiplier * friction;
            const newProgress = obj.onRail.progress + speed;
            
            // レールの終端に到達した場合
            if (newProgress >= 1) {
              // コレクションエリアの場合はスコア加算して消滅
              if (rail.type === 'collection') {
                const basePoints = obj.type === 'medal' ? 100 : 50;
                const multiplier = rail.multiplier || 1;
                const points = basePoints * multiplier;
                
                setScore(prev => prev + points);
                setLastCollected({
                  position: { x: obj.x, y: obj.y },
                  points,
                  timestamp: Date.now()
                });
                
                return null;
              }
              
              // 次のレールを探す
              const currentEndPoint = rail.points[rail.points.length - 1];
              const nextRailIndex = rails.findIndex((r, index) => 
                index !== obj.onRail?.railIndex && // 現在のレール以外
                r.points[0].x === currentEndPoint.x && 
                r.points[0].y === currentEndPoint.y
              );
              
              if (nextRailIndex !== -1) {
                // 次のレールが見つかった場合は移動
                return {
                  ...obj,
                  onRail: {
                    railIndex: nextRailIndex,
                    progress: 0
                  }
                } as GameObject;
              } else {
                // 次のレールが見つからない場合は自由落下に移行
                // レールの最後の2点から出口の角度を計算
                const lastPoint = rail.points[rail.points.length - 1];
                const prevPoint = rail.points[rail.points.length - 2];
                const exitAngle = Math.atan2(
                  lastPoint.y - prevPoint.y,
                  lastPoint.x - prevPoint.x
                );
                
                return {
                  ...obj,
                  onRail: undefined,
                  velocityX: Math.cos(exitAngle) * 2,
                  velocityY: Math.sin(exitAngle) * 2,
                  angle: exitAngle
                } as GameObject;
              }
            }
            
            // レール上の新しい位置と角度を計算
            const newPos = getPointOnRail(rail, newProgress);
            const nextPos = getPointOnRail(rail, Math.min(newProgress + 0.01, 1));
            const angle = Math.atan2(nextPos.y - newPos.y, nextPos.x - newPos.x);
            
            // 摩擦の更新（徐々に減少）
            const newFriction = Math.max(0.5, (obj.onRail.friction ?? 1.0) - 0.001);
            
            return {
              ...obj,
              x: newPos.x,
              y: newPos.y,
              angle,
              onRail: {
                ...obj.onRail,
                progress: newProgress,
                friction: newFriction,
                lastProgress: obj.onRail.progress,
                entryTime: obj.onRail.entryTime ?? Date.now()
              }
            } as GameObject;
          }
          
          // 通常の物理演算（レール上にないオブジェクト）
          const friction = 0.98 // 摩擦係数
          const gravity = 0.5 // 重力加速度
          const maxVelocity = 10 // 最大速度
          
          // プッシャーとの相対速度を考慮
          const relativeX = obj.x - pusherRef.current.position
          const pushEffect = relativeX > 0 && relativeX < 200 ? pusherRef.current.direction * 0.5 : 0
          
          return {
            ...obj,
            x: obj.x + obj.velocityX,
            y: obj.y + obj.velocityY,
            velocityX: (obj.velocityX * friction + pushEffect),
            velocityY: Math.min(obj.velocityY + gravity, maxVelocity)
          } as GameObject;
        });

        // Filter out null values and objects outside bounds, then cast to GameObject[]
        return updatedObjects.filter((obj): obj is GameObject => 
          obj !== null && 
          obj.y < canvas.height && 
          obj.x > 0 && 
          obj.x < canvas.width
        );
      })
    }

    const updatePusher = () => {
      // プッシャーの加速と減速を実装
      const targetSpeed = 2
      const acceleration = 0.1
      const currentSpeed = pusherRef.current.speed
      
      // 目標速度に向かってスムーズに変化
      if (Math.abs(currentSpeed) < targetSpeed) {
        pusherRef.current.speed += acceleration * pusherRef.current.direction
      } else if (Math.abs(currentSpeed) > targetSpeed) {
        pusherRef.current.speed -= acceleration * pusherRef.current.direction
      }
      
      // 位置の更新
      pusherRef.current.position += pusherRef.current.speed
      
      // 端に到達した場合の処理
      const margin = 20 // 余白
      const pusherWidth = 200
      if (pusherRef.current.position > canvas.width - pusherWidth - margin) {
        pusherRef.current.direction = -1
        pusherRef.current.speed = -Math.abs(pusherRef.current.speed) * 0.8 // 反発で減速
        pusherRef.current.position = canvas.width - pusherWidth - margin
      }
      if (pusherRef.current.position < margin) {
        pusherRef.current.direction = 1
        pusherRef.current.speed = Math.abs(pusherRef.current.speed) * 0.8 // 反発で減速
        pusherRef.current.position = margin
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // レールの描画（アウターグロー）
      rails.forEach(rail => {
        ctx.beginPath();
        const points = rail.points;
        
        // 外側のグロー効果 - アーケードスタイルのLED風
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        gradient.addColorStop(0, '#2563EB');  // 青色のベース
        gradient.addColorStop(0.5, '#60A5FA'); // 明るい青
        gradient.addColorStop(1, '#3B82F6');   // 中間の青

        // パルス効果の計算
        const pulseIntensity = Math.sin(Date.now() / 500) * 0.3 + 0.7;
        ctx.shadowColor = '#3B82F6';
        ctx.shadowBlur = 15 + (pulseIntensity * 10);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 6;
        
        ctx.moveTo(points[0].x, points[0].y);
        
        // ポイント間をベジェ曲線で接続
        for (let i = 1; i < points.length; i++) {
          const p1 = points[i - 1];
          const p2 = points[i];
          
          if (p1.controlX !== undefined && p1.controlY !== undefined) {
            const cp1x = p1.controlX;
            const cp1y = p1.controlY;
            const cp2x = p2.controlX ?? p2.x;
            const cp2y = p2.controlY ?? p2.y;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          } else {
            ctx.lineTo(p2.x, p2.y);
          }
        }
        
        ctx.stroke();
      });

      // レールの描画（インナーライン）
      rails.forEach(rail => {
        ctx.beginPath();
        const points = rail.points;
        
        // 内側の光る線 - アーケードスタイルのLED効果
        ctx.shadowColor = '#3B82F6';
        ctx.shadowBlur = 15;
        ctx.strokeStyle = '#93C5FD';
        ctx.lineWidth = 3;
        
        // グローエフェクトを二重に重ねて光り方を強調
        ctx.save();
        ctx.shadowColor = '#60A5FA';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        
        ctx.moveTo(points[0].x, points[0].y);
        
        for (let i = 1; i < points.length; i++) {
          const p1 = points[i - 1];
          const p2 = points[i];
          
          if (p1.controlX !== undefined && p1.controlY !== undefined) {
            const cp1x = p1.controlX;
            const cp1y = p1.controlY;
            const cp2x = p2.controlX ?? p2.x;
            const cp2y = p2.controlY ?? p2.y;
            
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
          } else {
            ctx.lineTo(p2.x, p2.y);
          }
        }
        
        ctx.stroke();
      });

      // デジタルディスプレイの描画 - アーケードスタイル
      const displayX = 20;
      const displayY = 20;
      const displayWidth = 200;
      const displayHeight = 80;
      
      // ディスプレイの外枠グロー
      ctx.shadowColor = '#3B82F6';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = '#60A5FA';
      ctx.lineWidth = 4;
      ctx.strokeRect(displayX - 2, displayY - 2, displayWidth + 4, displayHeight + 4);
      
      // ディスプレイの背景
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1A1A1A';
      ctx.strokeStyle = '#4A5568';
      ctx.lineWidth = 3;
      ctx.fillRect(displayX, displayY, displayWidth, displayHeight);
      ctx.strokeRect(displayX, displayY, displayWidth, displayHeight);
      
      // LEDパネル風のグリッド効果
      ctx.strokeStyle = 'rgba(74, 85, 104, 0.2)';
      ctx.lineWidth = 1;
      for (let i = displayX + 10; i < displayX + displayWidth; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, displayY);
        ctx.lineTo(i, displayY + displayHeight);
        ctx.stroke();
      }
      
      // LEDスタイルのテキスト効果
      ctx.shadowColor = '#60A5FA';
      ctx.shadowBlur = 10;
      ctx.font = 'bold 24px "Courier New"';
      ctx.fillStyle = '#60A5FA';
      ctx.textAlign = 'right';
      
      // スコア表示
      ctx.fillText(`${score.toString().padStart(6, '0')}`, displayX + displayWidth - 20, displayY + 35);
      
      // 日付表示
      const now = new Date();
      const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      ctx.font = 'bold 16px "Courier New"';
      ctx.fillText(dateStr, displayX + displayWidth - 20, displayY + 65);

      // 最後に獲得したポイントの表示
      if (lastCollected && Date.now() - lastCollected.timestamp < 1000) {
        const alpha = 1 - (Date.now() - lastCollected.timestamp) / 1000;
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = `rgba(45, 55, 72, ${alpha})`;
        ctx.textAlign = 'center';
        ctx.fillText(
          `+${lastCollected.points}`,
          lastCollected.position.x,
          lastCollected.position.y - 20 * (1 - alpha)
        );
      }

      // パーティクル効果の状態
      const particles: { x: number; y: number; age: number; color: string }[] = [];
      if (lastCollected && Date.now() - lastCollected.timestamp < 500) {
        for (let i = 0; i < 10; i++) {
          const angle = (Math.PI * 2 * i) / 10;
          const speed = 2;
          const age = (Date.now() - lastCollected.timestamp) / 500;
          particles.push({
            x: lastCollected.position.x + Math.cos(angle) * speed * age * 30,
            y: lastCollected.position.y + Math.sin(angle) * speed * age * 30,
            age,
            color: '#60A5FA'
          });
        }
      }

      // コレクションエリアの描画
      rails.filter(rail => rail.type === 'collection').forEach(rail => {
        const endPoint = rail.points[rail.points.length - 1];
        const isActive = lastCollected && 
          Math.abs(lastCollected.position.x - endPoint.x) < 20 &&
          Math.abs(lastCollected.position.y - endPoint.y) < 20 &&
          Date.now() - lastCollected.timestamp < 500;
        
        // 外側のグロー効果 - アーケードスタイルのLED
        ctx.beginPath();
        const collectionGradient = ctx.createRadialGradient(
          endPoint.x, endPoint.y, 0,
          endPoint.x, endPoint.y, isActive ? 50 : 40
        );
        collectionGradient.addColorStop(0, isActive ? '#93C5FD' : '#60A5FA');
        collectionGradient.addColorStop(0.6, isActive ? '#3B82F6' : '#2563EB');
        collectionGradient.addColorStop(1, '#1E3A8A');
        
        ctx.shadowColor = isActive ? '#93C5FD' : '#3B82F6';
        ctx.shadowBlur = isActive ? 40 : 25;
        ctx.fillStyle = collectionGradient;
        ctx.strokeStyle = isActive ? '#93C5FD' : '#60A5FA';
        ctx.lineWidth = 4;
        
        // パルス効果を追加
        const pulseSize = Math.sin(Date.now() / 500) * 3;
        ctx.arc(endPoint.x, endPoint.y, (isActive ? 40 : 35) + pulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // 中間の円
        ctx.beginPath();
        ctx.shadowColor = isActive ? '#60A5FA' : '#2563EB';
        ctx.shadowBlur = isActive ? 20 : 10;
        ctx.fillStyle = '#1E40AF';
        ctx.strokeStyle = isActive ? '#60A5FA' : '#3B82F6';
        ctx.lineWidth = 3;
        ctx.arc(endPoint.x, endPoint.y, isActive ? 30 : 25, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // 内側の円（光る部分）
        ctx.beginPath();
        ctx.shadowColor = isActive ? '#93C5FD' : '#60A5FA';
        ctx.shadowBlur = isActive ? 25 : 15;
        ctx.fillStyle = isActive ? '#60A5FA' : '#3B82F6';
        ctx.arc(endPoint.x, endPoint.y, isActive ? 20 : 15, 0, Math.PI * 2);
        ctx.fill();
        
        // マルチプライヤー表示
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = `${rail.multiplier}x`;
        ctx.fillText(label, endPoint.x, endPoint.y);
        
        // リップル効果
        if (isActive) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(147, 197, 253, ${1 - (Date.now() - lastCollected.timestamp) / 500})`;
          ctx.lineWidth = 2;
          const rippleSize = ((Date.now() - lastCollected.timestamp) / 500) * 50;
          ctx.arc(endPoint.x, endPoint.y, 40 + rippleSize, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      
      // パーティクル描画
      particles.forEach(particle => {
        ctx.beginPath();
        ctx.fillStyle = `rgba(96, 165, 250, ${1 - particle.age})`;
        ctx.arc(particle.x, particle.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });
      
      // 影効果をリセット
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      // 背景のグリッド
      ctx.strokeStyle = '#E2E8F0'
      ctx.lineWidth = 1
      for (let i = 0; i < canvas.width; i += 40) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i, canvas.height)
        ctx.stroke()
      }
      for (let i = 0; i < canvas.height; i += 40) {
        ctx.beginPath()
        ctx.moveTo(0, i)
        ctx.lineTo(canvas.width, i)
        ctx.stroke()
      }

      // プッシャーの描画
      ctx.fillStyle = '#4A5568'
      ctx.fillRect(pusherRef.current.position, canvas.height - 100, 200, 20)
      ctx.strokeStyle = '#2D3748'
      ctx.strokeRect(pusherRef.current.position, canvas.height - 100, 200, 20)

      // メダル投入口の描画（上部中央）
      const entryWidth = 60
      const entryHeight = 80
      const entryX = canvas.width / 2 - entryWidth / 2
      const entryY = 30
      ctx.strokeStyle = '#2D3748'
      ctx.lineWidth = 3
      ctx.strokeRect(entryX, entryY, entryWidth, entryHeight)
      ctx.fillStyle = '#E2E8F0'
      ctx.fillRect(entryX, entryY, entryWidth, entryHeight)
      
      // 投入口の矢印
      ctx.beginPath()
      ctx.moveTo(entryX + entryWidth / 2, entryY + 10)
      ctx.lineTo(entryX + entryWidth / 2, entryY + entryHeight - 10)
      ctx.strokeStyle = '#4A5568'
      ctx.lineWidth = 2
      ctx.stroke()
      
      // ルーレットの描画（右上）
      const rouletteX = canvas.width - 100
      const rouletteY = 120
      const rouletteRadius = 50
      
      // ルーレット背景
      ctx.beginPath()
      ctx.arc(rouletteX, rouletteY, rouletteRadius, 0, Math.PI * 2)
      ctx.strokeStyle = '#2D3748'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.fillStyle = isRouletteSpinning ? '#FCD34D' : '#E2E8F0'
      ctx.fill()
      
      // ルーレット装飾
      for (let i = 0; i < 9; i++) {
        const angle = (i * Math.PI * 2) / 9
        ctx.beginPath()
        ctx.moveTo(rouletteX, rouletteY)
        ctx.lineTo(
          rouletteX + Math.cos(angle) * rouletteRadius,
          rouletteY + Math.sin(angle) * rouletteRadius
        )
        ctx.strokeStyle = '#4A5568'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      
      if (isRouletteSpinning || rouletteNumber !== 0) {
        ctx.font = 'bold 24px Arial'
        ctx.fillStyle = '#2D3748'
        ctx.textAlign = 'center'
        ctx.fillText(rouletteNumber.toString(), canvas.width - 80, 90)
      }

      // メダルとボールの描画
      gameObjects.forEach(obj => {
        ctx.save()
        ctx.translate(obj.x, obj.y)
        if (obj.angle) {
          ctx.rotate(obj.angle)
        }
        ctx.fillStyle = obj.type === 'medal' ? '#FCD34D' : '#F97316'
        ctx.strokeStyle = obj.type === 'medal' ? '#D97706' : '#C2410C'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, obj.type === 'medal' ? 10 : 8, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      })
    }

    const checkCollisions = () => {
      setGameObjects(prevObjects => 
        prevObjects.map(obj => {
          // プッシャーとの衝突判定
          if (obj.y > canvas.height - 120 && obj.y < canvas.height - 80) {
            const pusherLeft = pusherRef.current.position
            const pusherRight = pusherRef.current.position + 200
            
            if (obj.x > pusherLeft && obj.x < pusherRight) {
              return {
                ...obj,
                y: canvas.height - 120,
                velocityY: -obj.velocityY * 0.5,
                velocityX: obj.velocityX + pusherRef.current.direction
              }
            }
          }

          // 左右の壁との衝突
          if (obj.x < 10 || obj.x > canvas.width - 10) {
            return {
              ...obj,
              x: obj.x < 10 ? 10 : canvas.width - 10,
              velocityX: -obj.velocityX * 0.8
            }
          }

          return obj
        })
      )
    }

    const animate = () => {
      updatePusher();
      updatePhysics();
      checkCollisions();
      draw();
      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const handleMedalInsert = () => {
    if (medals >= 1) {
      setMedals(prev => prev - 1)
      
      // メダルを投入枠に配置
      const medalX = canvasRef.current!.width / 2
      const medalY = 50
      setGameObjects(prev => [...prev, {
        x: medalX,
        y: medalY,
        type: 'medal',
        velocityX: 0,
        velocityY: 2
      }])

      // メダルが投入枠を通過したらルーレット開始
      setTimeout(() => {
        setIsRouletteSpinning(true)
        let spins = 0
        const spinInterval = setInterval(() => {
          setRouletteNumber(Math.floor(Math.random() * 9) + 1)
          spins++
          
          if (spins >= 20) {
            clearInterval(spinInterval)
            const finalNumber = Math.floor(Math.random() * 9) + 1
            setRouletteNumber(finalNumber)
            setIsRouletteSpinning(false)
            
            // 奇数の場合はボール、偶数の場合はメダル
            if (finalNumber % 2 === 1) {
              // ボールの払い出し - ランダムなエントリーレールを選択
              const entryRails = rails.filter(r => r.type === 'entry');
              const randomRailIndex = rails.indexOf(entryRails[Math.floor(Math.random() * entryRails.length)]);
              
              setGameObjects(prev => [...prev, {
                x: rails[randomRailIndex].points[0].x,
                y: rails[randomRailIndex].points[0].y,
                type: 'ball',
                velocityX: 0,
                velocityY: 0,
                onRail: {
                  railIndex: randomRailIndex,
                  progress: 0
                }
              }])
            } else {
              // メダルの払い出し（3枚）
              setMedals(prev => prev + 3)
              const entryRails = rails.filter(r => r.type === 'entry');
              
              for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                  const randomRailIndex = rails.indexOf(entryRails[Math.floor(Math.random() * entryRails.length)]);
                  setGameObjects(prev => [...prev, {
                    x: rails[randomRailIndex].points[0].x,
                    y: rails[randomRailIndex].points[0].y,
                    type: 'medal',
                    velocityX: 0,
                    velocityY: 0,
                    onRail: {
                      railIndex: randomRailIndex,
                      progress: 0,
                      friction: 1.0,
                      entryTime: Date.now()
                    }
                  }])
                }, i * 200)
              }
            }
          }
        }, 100)
      }, 1000) // メダルが投入枠を通過する時間を考慮
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-md mx-auto space-y-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold">メダルプッシャー</h1>
            <div className="flex items-center gap-2">
              <span className="text-yellow-500">🪙</span>
              <span>{medals}</span>
            </div>
          </div>
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            className="w-full bg-white rounded-lg shadow-inner mb-4 border border-gray-200"
          />
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <span className="text-sm font-medium">現在のメダル</span>
              <span className="text-lg font-bold text-yellow-500">{medals}</span>
            </div>
            <button
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
              onClick={handleMedalInsert}
              disabled={isRouletteSpinning || medals < 1}
            >
              🎮 メダルを投入する（1枚）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
