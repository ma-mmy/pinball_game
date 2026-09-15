/**
 * PinballPhysics - 2.5D 高精度物理模拟引擎 V3.0
 * 支持 12 落点槽位、动态倍率亮灯判定与平滑天花板发射轨迹
 */
class PinballPhysics {
    constructor(canvas, onEvent) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onEvent = onEvent || (() => {});

        // 画布基准尺寸 (400 x 570)
        this.width = 400;
        this.height = 570;

        // 物理常数
        // Heavier-feeling marble: stronger gravity and restrained bounce keep it
        // moving down through the board instead of returning to the launcher.
        this.gravity = 1580; // px/s^2
        this.restitution = 0.48;
        this.pinRestitution = 0.56;
        this.pillarRestitution = 0.58;
        this.topPillarRestitution = 0.58;
        // Deliberately exaggerated impulse for the eight marked pins; the
        // speed cap below keeps this dramatic without creating runaway energy.
        this.highElasticRestitution = 3.0;
        this.maxBounceSpeed = 1450;
        this.subSteps = 10;

        // 实体
        this.balls = [];
        this.pins = [];
        this.bumpers = [];
        this.walls = [];
        this.slots = [];
        this.particles = [];

        // 亮灯与倍率状态
        this.currentMultiplier = 0;
        this.pulseTime = 0;

        // 弹簧拉杆
        this.plunger = {
            x: 372,
            restY: 485,
            y: 485,
            maxY: 545,
            pullDist: 0,
            power: 0,
            isPulling: false
        };

        this.initPlayfield();
    }

    initPlayfield() {
        this.pins = [];
        this.bumpers = [];
        this.walls = [];
        this.slots = [];

        // 1. 发射滑道与外壁天花板
        // 右侧外壁 (y: 65 ~ 520, x: 388)
        this.walls.push({ x1: 388, y1: 65, x2: 388, y2: 520, radius: 2.5 });

        // 右上角转向圆弧 (圆心 348, 65, 半径 40)
        const arcSteps = 16;
        for (let i = 0; i < arcSteps; i++) {
            const a1 = (Math.PI / 2) * (i / arcSteps);
            const a2 = (Math.PI / 2) * ((i + 1) / arcSteps);
            const x1 = 348 + Math.cos(a1) * 40;
            const y1 = 65 - Math.sin(a1) * 40;
            const x2 = 348 + Math.cos(a2) * 40;
            const y2 = 65 - Math.sin(a2) * 40;
            this.walls.push({ x1, y1, x2, y2, radius: 2.5 });
        }

        // 最顶端水平天花板 (x: 60 ~ 348, y: 25)
        this.walls.push({ x1: 60, y1: 25, x2: 348, y2: 25, radius: 2.5 });

        // 左上角外弧 (圆心 60, 65, 半径 40)，底端直接接入左侧竖边
        for (let i = 0; i < arcSteps; i++) {
            const a1 = (Math.PI / 2) + (Math.PI / 2) * (i / arcSteps);
            const a2 = (Math.PI / 2) + (Math.PI / 2) * ((i + 1) / arcSteps);
            const x1 = 60 + Math.cos(a1) * 40;
            const y1 = 65 - Math.sin(a1) * 40;
            const x2 = 60 + Math.cos(a2) * 40;
            const y2 = 65 - Math.sin(a2) * 40;
            this.walls.push({ x1, y1, x2, y2, radius: 2.5 });
        }

        // 左侧主外壁略向内收，减少边缘卡珠死角。
        this.walls.push({ x1: 20, y1: 65, x2: 20, y2: 430, radius: 3 });

        // 发射道左分隔隔板 (x: 356, y: 120 ~ 470)
        this.walls.push({ x1: 356, y1: 120, x2: 356, y2: 470, radius: 2.5 });
        // 回球槽：尾部与弹簧位打通。底部止挡只保留在弹簧下方，
        // 球会沿斜坡滚回弹簧上方，不能从弹簧底部滑出。
        this.walls.push({ x1: 344, y1: 468, x2: 356, y2: 492, radius: 2.5 });
        this.walls.push({ x1: 350, y1: 500, x2: 388, y2: 500, radius: 3 });
        this.walls.push({ x1: 388, y1: 470, x2: 388, y2: 500, radius: 2.5 });

        // 隔板顶端向左弯曲导流嘴 (雨伞柄形状)
        for (let i = 0; i < 8; i++) {
            const a1 = (Math.PI / 2) * (i / 8);
            const a2 = (Math.PI / 2) * ((i + 1) / 8);
            const x1 = 338 + Math.cos(a1) * 18;
            const y1 = 120 - Math.sin(a1) * 14;
            const x2 = 338 + Math.cos(a2) * 18;
            const y2 = 120 - Math.sin(a2) * 14;
            this.walls.push({ x1, y1, x2, y2, radius: 2 });
        }

        // 2. 阻挡立柱群 (左上方立柱 + 中央横向胶垫)
        const leftBlockingPillars = [
            // Left-lower to right-upper diagonal under the corner arc.
            { id: 'pillar_tl_1', x: 42, y: 62, radius: 9.5 },
            { id: 'pillar_tl_2', x: 58, y: 42, radius: 9.5 }
        ];
        leftBlockingPillars.forEach(p => {
            this.bumpers.push({
                ...p,
                isLeftBlocker: true,
                hitTimer: 0,
                flashTimer: 0,
                highElastic: false
            });
        });

        const midBumpers = [
            { id: 'bumper_mid_1', x: 82, y: 74, radius: 8.5 },
            { id: 'bumper_mid_2', x: 130, y: 74, radius: 8.5 },
            { id: 'bumper_mid_3', x: 178, y: 74, radius: 8.5 },
            { id: 'bumper_mid_4', x: 226, y: 74, radius: 8.5 },
            { id: 'bumper_mid_5', x: 274, y: 74, radius: 8.5 },
            { id: 'bumper_mid_6', x: 322, y: 74, radius: 8.5 }
        ];
        midBumpers.forEach(b => {
            this.bumpers.push({
                ...b,
                isLeftBlocker: false,
                hitTimer: 0,
                flashTimer: 0,
                highElastic: false
            });
        });

        // 3. 高尔顿钉阵 (交错排布)
        const rowConfigs = [
            { y: 131, startX: 35, count: 10, gap: 34, edgeShift: -5 },
            { y: 177, startX: 52, count: 9, gap: 34, edgeShift: -5 },
            { y: 217, startX: 35, count: 10, gap: 34, edgeShift: -5 },
            { y: 257, startX: 52, count: 9, gap: 34 },
            { y: 302, startX: 35, count: 10, gap: 34 }
        ];
        rowConfigs.forEach((cfg, rowIdx) => {
            for (let i = 0; i < cfg.count; i++) {
                const px = cfg.startX + i * cfg.gap + (i === 0 ? (cfg.edgeShift || 0) : 0);
                if (px >= 344 || px <= 24) continue;
                this.pins.push({
                    id: `p_${rowIdx}_${i}`,
                    x: px,
                    y: cfg.y,
                    radius: 3.5,
                    flashTimer: 0,
                    highElastic: false,
                    pitch: 0.8 + (px / 350) * 0.5
                });
            }
        });

        // 4. 底部 12 个落点孔洞 (12 个落点中根据倍率随机选取亮灯)
        const slotCount = 10;
        const slotStartX = 18;
        const slotWidth = (346 - slotStartX) / slotCount; // ~27.33 px
        const slotY = 382;

        for (let i = 0; i < slotCount; i++) {
            const sx = slotStartX + i * slotWidth + slotWidth / 2;
            this.slots.push({
                index: i,
                x: sx,
                y: slotY,
                radius: 9.0,
                // The rightmost pocket opens into the side channel, so its
                // scoring area extends to the right border as well.
                hitWidth: i === slotCount - 1 ? 27 : 12,
                hitHeight: i === slotCount - 1 ? 20 : 12,
                isLit: false,
                multiplier: 0,
                flashTimer: 0,
                color: '#ff1744'
            });

            // 槽位之间的垂直分隔桩 (Dividers)
            if (i > 0) {
                const divX = slotStartX + i * slotWidth;
                this.walls.push({
                    x1: divX,
                    y1: slotY - 14,
                    x2: divX,
                    y2: slotY + 14,
                    radius: 1.8
                });
            }
        }

        // 底端斜向集球导轨
        this.walls.push({ x1: 20, y1: 442, x2: 345, y2: 468, radius: 2 });
    }

    // 设置亮灯格与倍率
    setLitSlots(litIndices, multiplier) {
        this.currentMultiplier = multiplier;
        this.slots.forEach(slot => {
            slot.isLit = litIndices.includes(slot.index);
            slot.multiplier = slot.isLit ? multiplier : 0;
            if (slot.isLit) {
                slot.flashTimer = 0.6;
            }
        });
    }

    randomizeHighElasticPins(count = 8) {
        this.pins.forEach(pin => { pin.highElastic = false; });
        const shuffled = [...this.pins];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        shuffled.slice(0, Math.min(count, shuffled.length)).forEach(pin => {
            pin.highElastic = true;
        });
    }

    // 清除亮灯
    clearLitSlots() {
        this.currentMultiplier = 0;
        this.slots.forEach(slot => {
            slot.isLit = false;
            slot.multiplier = 0;
            slot.flashTimer = 0;
        });
    }

    // 装填待发弹珠
    loadBall(skin = 'classic') {
        const newBall = {
            id: 'ball_' + Date.now() + '_' + Math.random(),
            x: 372,
            y: this.plunger.restY - 9,
            vx: 0,
            vy: 0,
            radius: 9,
            mass: 1.25,
            skin: skin,
            state: 'ready'
        };
        this.balls.push(newBall);
        return newBall;
    }

    setPlungerPull(pullDist) {
        this.plunger.pullDist = Math.max(0, Math.min(60, pullDist));
        this.plunger.y = this.plunger.restY + this.plunger.pullDist;
        this.plunger.power = this.plunger.pullDist / 60;
    }

    releasePlunger() {
        const power = this.plunger.power;
        if (power > 0.05) {
            const readyBall = this.balls.find(b => b.state === 'ready' && b.x > 350 && b.y >= 430);
            if (readyBall) {
                // Keep a light initial push, then increase force linearly with pull distance.
                const launchSpeed = -(650 + power * 1500);
                readyBall.vy = launchSpeed;
                readyBall.vx = (Math.random() - 0.5) * 8;
                readyBall.state = 'launched';
            }
            this.onEvent('plunger_release', { power });
        }
        this.plunger.pullDist = 0;
        this.plunger.y = this.plunger.restY;
        this.plunger.power = 0;
    }

    // Dislodge a marble that is moving through the playfield without
    // returning it to the plunger or changing its launch state.
    shakeActiveBall() {
        const activeBall = this.balls.find(ball =>
            ball.state === 'launched' || ball.state === 'in_play'
        );
        if (!activeBall) return false;

        const direction = Math.random() < 0.5 ? -1 : 1;
        activeBall.vx += direction * 260;
        activeBall.vy += 120;
        return true;
    }

    update(dt) {
        const clampedDt = Math.min(dt, 0.035);
        const subDt = clampedDt / this.subSteps;

        for (let step = 0; step < this.subSteps; step++) {
            this.subStep(subDt);
        }

        this.updateTimers(clampedDt);
    }

    subStep(dt) {
        for (let i = this.balls.length - 1; i >= 0; i--) {
            const ball = this.balls[i];
            if (ball.state === 'scored') continue;

            ball.vy += this.gravity * dt;

            if (ball.state === 'ready') {
                if (ball.y > this.plunger.y - ball.radius) {
                    ball.y = this.plunger.y - ball.radius;
                    ball.vy = 0;
                }
            } else if (ball.state === 'launched') {
                ball.x += ball.vx * dt;
                ball.y += ball.vy * dt;

                if (ball.y < 80 && ball.x < 350) {
                    ball.state = 'in_play';
                }
            } else if (ball.state === 'in_play') {
                ball.x += ball.vx * dt;
                ball.y += ball.vy * dt;
            }

            // Small amount of rolling drag gives the marble weight without
            // making it stick on the pegs.
            if (ball.state !== 'ready') {
                ball.vx *= 0.9992;
                ball.vy *= 0.9996;
            }

            // The open tail feeds the marble back to the plunger. Once it
            // reaches the lower return lane, park it above the spring stop so
            // it cannot roll underneath or get stranded in the chute.
            if ((ball.state === 'launched' || ball.state === 'in_play') &&
                ball.x > 344 && ball.y >= 448 && ball.vy >= 0) {
                ball.state = 'ready';
                ball.x = 372;
                ball.y = this.plunger.y - ball.radius;
                ball.vx = 0;
                ball.vy = 0;
                this.onEvent('ball_returned', { ball });
            }

            // 墙壁碰撞
            for (const wall of this.walls) {
                this.resolveBallWallCollision(ball, wall);
            }

            // 阻挡立柱碰撞
            for (const bumper of this.bumpers) {
                const dx = ball.x - bumper.x;
                const dy = ball.y - bumper.y;
                const dist = Math.hypot(dx, dy);
                const minDist = ball.radius + bumper.radius;

                if (dist < minDist && dist > 0.0001) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    ball.x = bumper.x + nx * minDist;
                    ball.y = bumper.y + ny * minDist;

                    const vn = ball.vx * nx + ball.vy * ny;
                    if (vn < 0) {
                        const bounceRest = bumper.highElastic
                            ? this.highElasticRestitution
                            : bumper.y <= 130
                            ? this.topPillarRestitution
                            : this.pillarRestitution;
                        ball.vx = ball.vx - (1 + bounceRest) * vn * nx;
                        ball.vy = ball.vy - (1 + bounceRest) * vn * ny;
                        const speed = Math.hypot(ball.vx, ball.vy);
                        if (speed > this.maxBounceSpeed) {
                            const scale = this.maxBounceSpeed / speed;
                            ball.vx *= scale;
                            ball.vy *= scale;
                        }

                        bumper.hitTimer = 0.2;
                        bumper.flashTimer = 0.25;
                        this.createSparks(bumper.x, bumper.y, 6, bumper.isLeftBlocker ? '#ffca28' : '#ffffff');

                        this.onEvent('bumper_hit', {
                            id: bumper.id,
                            isLeftBlocker: bumper.isLeftBlocker,
                            x: bumper.x,
                            y: bumper.y
                        });
                    }
                }
            }

            // 钉阵碰撞
            for (const pin of this.pins) {
                const dx = ball.x - pin.x;
                const dy = ball.y - pin.y;
                const dist = Math.hypot(dx, dy);
                const minDist = ball.radius + pin.radius;

                if (dist < minDist && dist > 0.0001) {
                    const nx = dx / dist;
                    const ny = dy / dist;
                    ball.x = pin.x + nx * minDist;
                    ball.y = pin.y + ny * minDist;

                    const vn = ball.vx * nx + ball.vy * ny;
                    if (vn < 0) {
                        const randomJitter = (Math.random() - 0.5) * 15;
                        const pinRest = pin.highElastic ? this.highElasticRestitution : this.pinRestitution;
                        ball.vx = (ball.vx - (1 + pinRest) * vn * nx) + randomJitter;
                        ball.vy = ball.vy - (1 + pinRest) * vn * ny;
                        const speed = Math.hypot(ball.vx, ball.vy);
                        if (speed > this.maxBounceSpeed) {
                            const scale = this.maxBounceSpeed / speed;
                            ball.vx *= scale;
                            ball.vy *= scale;
                        }

                        pin.flashTimer = 0.12;
                        this.createSparks(pin.x, pin.y, 3);
                        this.onEvent('pin_hit', { pitch: pin.pitch, x: pin.x, y: pin.y });
                    }
                }
            }

            // 12 孔落点判定
            if (ball.state === 'in_play' && ball.y >= 380 && ball.y <= 415) {
                for (const slot of this.slots) {
                    const dx = ball.x - slot.x;
                    const dy = ball.y - slot.y;
                    const dist = Math.hypot(dx, dy);

                    const inSlot = slot.index === this.slots.length - 1
                        ? Math.abs(dx) < slot.hitWidth && Math.abs(dy) < slot.hitHeight
                        : dist < slot.radius + 3;

                    if (inSlot) {
                        ball.state = 'scored';
                        slot.flashTimer = 0.55;
                        this.createSparks(slot.x, slot.y, slot.isLit ? 20 : 6, slot.isLit ? '#ff1744' : '#aaaaaa');
                        this.onEvent('slot_score', { slot: slot, ball: ball });

                        setTimeout(() => {
                            const idx = this.balls.indexOf(ball);
                            if (idx !== -1) this.balls.splice(idx, 1);
                        }, 500);
                        break;
                    }
                }
            }

            // 球与球碰撞
            for (let j = i - 1; j >= 0; j--) {
                const other = this.balls[j];
                if (other.state === 'ready' && ball.state === 'ready') continue;
                this.resolveBallBallCollision(ball, other);
            }

            // 底部掉出保护
            if (ball.y > this.height + 40) {
                this.balls.splice(i, 1);
                this.onEvent('ball_lost', { ball });
            }
        }
    }

    resolveBallWallCollision(ball, wall) {
        const { x1, y1, x2, y2, radius } = wall;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return;

        let t = ((ball.x - x1) * dx + (ball.y - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const nearestX = x1 + t * dx;
        const nearestY = y1 + t * dy;

        const distVecX = ball.x - nearestX;
        const distVecY = ball.y - nearestY;
        const dist = Math.hypot(distVecX, distVecY);
        const minDist = ball.radius + (radius || 1);

        if (dist < minDist && dist > 0.0001) {
            const nx = distVecX / dist;
            const ny = distVecY / dist;

            ball.x = nearestX + nx * minDist;
            ball.y = nearestY + ny * minDist;

            const vn = ball.vx * nx + ball.vy * ny;
            if (vn < 0) {
                ball.vx = ball.vx - (1 + this.restitution) * vn * nx;
                ball.vy = ball.vy - (1 + this.restitution) * vn * ny;
            }
        }
    }

    resolveBallBallCollision(b1, b2) {
        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = b1.radius + b2.radius;

        if (dist < minDist && dist > 0.0001) {
            const nx = dx / dist;
            const ny = dy / dist;

            const overlap = (minDist - dist) * 0.5;
            b1.x -= nx * overlap;
            b1.y -= ny * overlap;
            b2.x += nx * overlap;
            b2.y += ny * overlap;

            const kx = b1.vx - b2.vx;
            const ky = b1.vy - b2.vy;
            const p = 2 * (nx * kx + ny * ky) / 2;

            b1.vx -= p * nx * 0.85;
            b1.vy -= p * ny * 0.85;
            b2.vx += p * nx * 0.85;
            b2.vy += p * ny * 0.85;
        }
    }

    createSparks(x, y, count = 6, color = '#ffeb3b') {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 120;
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.25 + Math.random() * 0.2,
                maxLife: 0.35,
                color: color,
                radius: 1.5 + Math.random() * 2
            });
        }
    }

    updateTimers(dt) {
        this.pulseTime += dt;
        this.pins.forEach(p => { if (p.flashTimer > 0) p.flashTimer -= dt; });
        this.bumpers.forEach(b => {
            if (b.hitTimer > 0) b.hitTimer -= dt;
            if (b.flashTimer > 0) b.flashTimer -= dt;
        });
        this.slots.forEach(s => { if (s.flashTimer > 0) s.flashTimer -= dt; });

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const pt = this.particles[i];
            pt.x += pt.vx * dt;
            pt.y += pt.vy * dt;
            pt.life -= dt;
            if (pt.life <= 0) this.particles.splice(i, 1);
        }
    }

    render() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // 1. 发射滑道与外壁轨道
        ctx.save();
        ctx.strokeStyle = '#d7cfc1';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.walls.forEach(w => {
            ctx.beginPath();
            ctx.moveTo(w.x1, w.y1);
            ctx.lineTo(w.x2, w.y2);
            ctx.stroke();
        });

        // 导流嘴高光
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(338, 120, 18, -Math.PI / 2, 0);
        ctx.stroke();
        ctx.restore();

        // 2. 阻挡立柱群
        this.bumpers.forEach(b => {
            ctx.save();
            const isHit = b.hitTimer > 0;

            ctx.beginPath();
            ctx.arc(b.x + 1.5, b.y + 2.5, b.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
            ctx.fill();

            const colGrad = ctx.createRadialGradient(
                b.x - b.radius * 0.35, b.y - b.radius * 0.35, 1,
                b.x, b.y, b.radius
            );

            if (b.highElastic) {
                colGrad.addColorStop(0, '#fff5f5');
                colGrad.addColorStop(0.45, '#ffcdd2');
                colGrad.addColorStop(1, '#e57373');
            } else if (b.isLeftBlocker) {
                if (isHit) {
                    colGrad.addColorStop(0, '#ffffff');
                    colGrad.addColorStop(0.5, '#ffe082');
                    colGrad.addColorStop(1, '#ffb300');
                } else {
                    colGrad.addColorStop(0, '#ffffff');
                    colGrad.addColorStop(0.4, '#f8f5ee');
                    colGrad.addColorStop(0.85, '#e0d6c4');
                    colGrad.addColorStop(1, '#baa993');
                }
            } else {
                if (isHit) {
                    colGrad.addColorStop(0, '#ffffff');
                    colGrad.addColorStop(1, '#ffecb3');
                } else {
                    colGrad.addColorStop(0, '#ffffff');
                    colGrad.addColorStop(0.6, '#f3ede1');
                    colGrad.addColorStop(1, '#cfc4b0');
                }
            }

            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
            ctx.fillStyle = colGrad;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = '#8d7b68';
            ctx.fill();

            ctx.lineWidth = 1.6;
            ctx.strokeStyle = isHit ? '#ffa000' : 'rgba(255, 255, 255, 0.9)';
            ctx.stroke();
            ctx.restore();
        });

        // 3. 底部 12 个落点孔洞 (亮灯格高亮闪烁，未亮灯暗淡)
        const pulse = Math.sin(this.pulseTime * 6) * 0.5 + 0.5; // 0 ~ 1 闪烁呼吸
        this.slots.forEach(s => {
            ctx.save();

            // 孔洞背景
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);

            if (s.isLit) {
                // 亮灯格：犹如真机红色发光光圈与红球发光指示
                ctx.fillStyle = s.flashTimer > 0 ? '#ffffff' : '#ff1744';
                ctx.shadowColor = '#ff1744';
                ctx.shadowBlur = s.flashTimer > 0 ? 18 : (8 + pulse * 8);
                ctx.fill();

                // 外发光环
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = '#ffebee';
                ctx.stroke();

                // 核心亮点
                ctx.beginPath();
                ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();

                // 上方倍率小字标签
                ctx.fillStyle = '#d50000';
                ctx.font = 'bold 9px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(`${s.multiplier}×`, s.x, s.y + 20);
            } else {
                // 未亮灯格：深色凹坑（对应原图的黑色圆孔）
                ctx.fillStyle = s.flashTimer > 0 ? '#444444' : '#231e1a';
                ctx.shadowBlur = 0;
                ctx.fill();

                ctx.lineWidth = 1.5;
                ctx.strokeStyle = '#6d6254';
                ctx.stroke();

                // 凹陷内阴影
                ctx.beginPath();
                ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#171412';
                ctx.fill();

                ctx.fillStyle = '#8c8275';
                ctx.font = 'bold 8px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('0', s.x, s.y + 20);
            }

            ctx.restore();
        });

        // 4. 金属细钉
        this.pins.forEach(pin => {
            ctx.save();
            const isFlashing = pin.flashTimer > 0;

            ctx.beginPath();
            ctx.arc(pin.x + 0.8, pin.y + 1.2, pin.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fill();

            const grad = ctx.createRadialGradient(
                pin.x - 1, pin.y - 1, 0.5,
                pin.x, pin.y, pin.radius
            );
            if (pin.highElastic) {
                grad.addColorStop(0, '#fff5f5');
                grad.addColorStop(0.45, '#ffcdd2');
                grad.addColorStop(1, '#e57373');
            } else if (isFlashing) {
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(1, '#ffb300');
            } else {
                grad.addColorStop(0, '#ffffff');
                grad.addColorStop(0.4, '#c2bcb0');
                grad.addColorStop(1, '#696156');
            }

            ctx.beginPath();
            ctx.arc(pin.x, pin.y, pin.radius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.restore();
        });

        // 5. 弹簧拉杆视觉
        this.renderPlunger(ctx);

        // 6. 弹珠渲染
        this.balls.forEach(ball => {
            this.renderBall(ctx, ball);
        });

        // 7. 粒子火花
        this.particles.forEach(pt => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
            ctx.fillStyle = pt.color;
            ctx.shadowColor = pt.color;
            ctx.shadowBlur = 6;
            ctx.fill();
            ctx.restore();
        });
    }

    renderBall(ctx, ball) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(ball.x + 2, ball.y + 3, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fill();

        const radGrad = ctx.createRadialGradient(
            ball.x - ball.radius * 0.35,
            ball.y - ball.radius * 0.35,
            ball.radius * 0.1,
            ball.x,
            ball.y,
            ball.radius
        );

        if (ball.skin === 'gold') {
            radGrad.addColorStop(0, '#fffbe6');
            radGrad.addColorStop(0.3, '#ffd700');
            radGrad.addColorStop(0.8, '#b8860b');
            radGrad.addColorStop(1, '#5c4308');
        } else if (ball.skin === 'neon') {
            radGrad.addColorStop(0, '#e0f7fa');
            radGrad.addColorStop(0.3, '#00e5ff');
            radGrad.addColorStop(0.8, '#0097a7');
            radGrad.addColorStop(1, '#004d40');
        } else {
            radGrad.addColorStop(0, '#ffffff');
            radGrad.addColorStop(0.25, '#eaecee');
            radGrad.addColorStop(0.65, '#95a5a6');
            radGrad.addColorStop(1, '#34495e');
        }

        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fillStyle = radGrad;
        ctx.fill();
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.stroke();

        ctx.restore();
    }

    renderPlunger(ctx) {
        const p = this.plunger;
        ctx.save();

        const springTopY = 465;
        const springBottomY = p.y;
        const coils = 9;
        const dy = (springBottomY - springTopY) / coils;

        ctx.beginPath();
        ctx.strokeStyle = '#857e72';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.moveTo(p.x, springTopY);
        for (let i = 0; i < coils; i++) {
            const midY = springTopY + (i + 0.5) * dy;
            const endY = springTopY + (i + 1) * dy;
            const xOffset = (i % 2 === 0 ? 1 : -1) * 7;
            ctx.quadraticCurveTo(p.x + xOffset, midY, p.x, endY);
        }
        ctx.stroke();

        ctx.fillStyle = '#645d52';
        ctx.fillRect(p.x - 9, p.y - 8, 18, 8);
        ctx.fillStyle = '#dcd5c7';
        ctx.fillRect(p.x - 7, p.y - 12, 14, 4);

        ctx.restore();
    }
}
