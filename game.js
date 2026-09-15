/**
 * HappyPinballGame - 主游戏控制与业务逻辑 V3.0
 * 1. 免费加珠：无需等待广告，输入密码 ma123456 后设定添加珠子数量
 * 2. 5~99 投珠开局，按开始确定倍率 (2×/4×/6×/8×/10×)，按倍率点亮 12 落点对应灯格
 * 3. 亮灯后发射前可追加投珠 (上限 99)
 * 4. 中奖返珠 = 倍率 × 投珠，积分卡 = min(floor(返珠 / T), J)
 * 5. 点击投珠 +1、快捷投珠 +5/+10，长按高速连续投珠
 * 6. 所有积分珠子默认为 0
 */
class PinballGame {
    constructor() {
        this.canvas = document.getElementById('playfield-canvas');
        this.totalScoreEl = document.getElementById('disp-total-score');
        this.totalBeadsEl = document.getElementById('disp-total-beads');
        this.rewardBeadsEl = document.getElementById('disp-reward-beads');
        this.rewardScoreEl = document.getElementById('disp-reward-score');
        this.loadedCountEl = document.getElementById('loaded-ball-count');
        this.statusTextEl = document.getElementById('status-bar-text');
        this.multiplierBadgeEl = document.getElementById('multiplier-badge');
        this.plungerKnob = document.getElementById('plunger-knob');
        this.plungerSpringVisual = document.getElementById('plunger-spring-visual');
        this.catTray = document.getElementById('cat-tray');
        this.coinSlot = document.querySelector('.coin-slot-bar');
        this.hopperExit = document.querySelector('.hopper-exit-chute');

        // 数据存储 (默认全为 0)
        this.totalScore = parseInt(localStorage.getItem('hpb_total_score_v3') || '0', 10);
        this.totalBeads = parseInt(localStorage.getItem('hpb_total_beads_v3') || '0', 10);
        this.rewardBeads = 0;
        this.rewardScore = 0;

        // 全局规则由所有机器共享；弹珠和积分仍保存在当前机器。
        this.globalConfigStorageKey = 'hpb_global_config_v1';
        this.globalConfigChannel = this.createGlobalConfigChannel();
        this.applyGlobalConfig(this.loadGlobalConfig());

        // 对局状态
        this.currentBet = 0; // 当前投入珠子 (5 ~ 99)
        this.currentMultiplier = 0; // 锁定倍率 (2, 4, 6, 8, 10)
        this.litSlots = []; // 当前点亮的落点槽位索引
        this.currentSkin = localStorage.getItem('hpb_ball_skin') || 'classic';
        this.gameState = 'IDLE'; // IDLE, MULTIPLIER_ROLLING, READY_TO_LAUNCH, BALL_IN_PLAY, RESOLVING

        // 物理引擎
        this.physics = new PinballPhysics(this.canvas, this.handlePhysicsEvent.bind(this));

        // 长按投珠计时器
        this.insertHoldTimer = null;
        this.insertHoldInterval = null;

        // 拉杆拖拽状态
        this.isPullingPlunger = false;
        this.pullStartY = 0;
        this.lastSoundPullDist = 0;
        this.lastPinSoundAt = 0;
        this.lastBumperSoundAt = 0;

        this.initUI();
        this.initEventListeners();
        this.initGlobalConfigSync();
        this.updateHUD();

        // 启动主循环
        this.lastTime = performance.now();
        requestAnimationFrame(this.loop.bind(this));
    }

    initUI() {
        this.updateHUD();
        this.setStatus('等待开始 (请投入 5~99 颗弹珠开局)');
    }

    updateHUD() {
        this.totalScoreEl.textContent = this.totalScore;
        this.totalBeadsEl.textContent = this.totalBeads;
        this.rewardBeadsEl.textContent = this.rewardBeads;
        this.rewardScoreEl.textContent = this.rewardScore;

        if (this.loadedCountEl) {
            this.loadedCountEl.textContent = `${this.currentBet}`;
        }

        if (this.multiplierBadgeEl) {
            if (this.currentMultiplier > 0) {
                this.multiplierBadgeEl.textContent = `${this.currentMultiplier}×`;
                this.multiplierBadgeEl.classList.add('active');
            } else {
                this.multiplierBadgeEl.textContent = '--';
                this.multiplierBadgeEl.classList.remove('active');
            }
        }

        localStorage.setItem('hpb_total_score_v3', this.totalScore);
        localStorage.setItem('hpb_total_beads_v3', this.totalBeads);
    }

    loadGlobalConfig() {
        const defaults = {
            soundEnabled: true,
            configT: 20,
            configJ: 10,
            multiplierProbabilities: [42, 28.8, 12.7, 10.8, 5.7]
        };

        try {
            const saved = JSON.parse(localStorage.getItem(this.globalConfigStorageKey) || 'null');
            if (this.isValidGlobalConfig(saved)) return saved;

            // Migrate settings saved by earlier versions into the shared config.
            const oldProbabilities = JSON.parse(localStorage.getItem('hpb_multiplier_probabilities') || 'null');
            const migrated = {
                ...defaults,
                configT: parseInt(localStorage.getItem('hpb_config_t') || defaults.configT, 10),
                configJ: parseInt(localStorage.getItem('hpb_config_j') || defaults.configJ, 10),
                multiplierProbabilities: Array.isArray(oldProbabilities)
                    ? oldProbabilities.map(Number) : defaults.multiplierProbabilities
            };
            return this.isValidGlobalConfig(migrated) ? migrated : defaults;
        } catch (e) {
            return defaults;
        }
    }

    isValidGlobalConfig(config) {
        if (!config || typeof config.soundEnabled !== 'boolean' ||
            !Number.isInteger(config.configT) || config.configT <= 0 ||
            !Number.isInteger(config.configJ) || config.configJ <= 0 ||
            !Array.isArray(config.multiplierProbabilities) || config.multiplierProbabilities.length !== 5) {
            return false;
        }
        const probabilities = config.multiplierProbabilities.map(Number);
        const total = probabilities.reduce((sum, value) => sum + value, 0);
        return probabilities.every(value => Number.isFinite(value) && value >= 0) && Math.abs(total - 100) <= 0.01;
    }

    applyGlobalConfig(config, notify = false) {
        if (!this.isValidGlobalConfig(config)) return false;
        this.configT = config.configT;
        this.configJ = config.configJ;
        this.multiplierProbabilities = config.multiplierProbabilities.map(Number);
        if (window.soundEngine) window.soundEngine.enabled = config.soundEnabled;

        if (notify) {
            this.populateGlobalSettingsFields();
            this.setStatus('全部机器配置已同步更新', true);
        }
        return true;
    }

    getGlobalConfig() {
        return {
            soundEnabled: !!(window.soundEngine && window.soundEngine.enabled),
            configT: this.configT,
            configJ: this.configJ,
            multiplierProbabilities: [...this.multiplierProbabilities]
        };
    }

    async saveGlobalConfig(config) {
        localStorage.setItem(this.globalConfigStorageKey, JSON.stringify(config));
        if (this.globalConfigChannel) this.globalConfigChannel.postMessage(config);
        if (!/^https?:$/.test(window.location.protocol)) return false;

        try {
            const response = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            return response.ok;
        } catch (e) {
            return false;
        }
    }

    createGlobalConfigChannel() {
        if (typeof BroadcastChannel !== 'function') return null;
        try {
            return new BroadcastChannel('hpb_global_config');
        } catch (e) {
            return null;
        }
    }

    initGlobalConfigSync() {
        window.addEventListener('storage', (event) => {
            if (event.key !== this.globalConfigStorageKey || !event.newValue) return;
            try {
                this.applyGlobalConfig(JSON.parse(event.newValue), true);
            } catch (e) {
                // Ignore malformed values written outside the settings UI.
            }
        });
        if (this.globalConfigChannel) {
            this.globalConfigChannel.addEventListener('message', (event) => {
                this.applyGlobalConfig(event.data, true);
            });
        }
        if (/^https?:$/.test(window.location.protocol)) {
            this.pullGlobalConfig();
            this.globalConfigPollTimer = setInterval(() => this.pullGlobalConfig(), 5000);
        }
    }

    async pullGlobalConfig() {
        try {
            const response = await fetch('/api/config', { cache: 'no-store' });
            if (!response.ok) return false;
            const config = await response.json();
            if (!this.applyGlobalConfig(config)) return false;
            localStorage.setItem(this.globalConfigStorageKey, JSON.stringify(config));
            return true;
        } catch (e) {
            return false;
        }
    }

    setStatus(text, isHighlight = false) {
        if (!this.statusTextEl) return;
        this.statusTextEl.textContent = text;
        if (isHighlight) {
            this.statusTextEl.classList.add('highlight');
            setTimeout(() => this.statusTextEl.classList.remove('highlight'), 1200);
        }
    }

    insertBalls(requestedCount = 1) {
        if (this.gameState === 'BALL_IN_PLAY' || this.gameState === 'RESOLVING' || this.gameState === 'MULTIPLIER_ROLLING') {
            return false;
        }

        if (this.totalBeads <= 0) {
            this.setStatus('⚠️ 珠子不足！请点击【免费加珠】输入密码补充', true);
            this.highlightAddBeadsBtn();
            return false;
        }

        if (this.currentBet >= 99) {
            this.setStatus('投珠已达上限 99 颗！', true);
            return false;
        }

        const insertCount = Math.min(requestedCount, this.totalBeads, 99 - this.currentBet);
        if (insertCount <= 0) return false;

        this.totalBeads -= insertCount;
        this.currentBet += insertCount;
        this.updateHUD();
        window.soundEngine.playInsertBead();
        this.playInsertEffect();

        if (this.currentMultiplier > 0) {
            this.setStatus(`追加投珠：当前共投 ${this.currentBet} 颗！倍率: ${this.currentMultiplier}×`);
        } else {
            this.setStatus(`当前已投: ${this.currentBet} 颗 (投入 5~99 颗后按【开始】确定倍率)`);
        }
        return true;
    }

    // 单次增加 1 颗投珠
    insertSingleBall() {
        return this.insertBalls(1);
    }

    // 点击开始按钮
    onStartBtnClicked() {
        window.soundEngine.playBtnClick();

        if (this.gameState === 'BALL_IN_PLAY' || this.gameState === 'RESOLVING' || this.gameState === 'MULTIPLIER_ROLLING') {
            return;
        }

        // 阶段一：尚未确定倍率
        if (this.currentMultiplier === 0) {
            if (this.currentBet < 5) {
                this.setStatus(`⚠️ 最少需投入 5 颗弹珠才能开局！(当前已投: ${this.currentBet} 颗)`, true);
                this.highlightInsertBtn();
                return;
            }

            // 投入达到 5~99 颗，开始摇号抽取倍率
            this.rollMultiplier();
            return;
        }

        // 阶段二：倍率已经锁定，提醒拉杆发射
        this.setStatus(`👉 倍率已锁定为 ${this.currentMultiplier}×！向下拉到底释放拉杆发射！`, true);
        this.pulsePlunger();
    }

    // 确定倍率过程 (轮播动画)
    rollMultiplier() {
        this.gameState = 'MULTIPLIER_ROLLING';
        this.setStatus('🎲 正在抽取本局倍率...');

        const availableMultipliers = [2, 4, 6, 8, 10];
        const weights = this.multiplierProbabilities;
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let rnd = Math.random() * totalWeight;
        let chosenMult = 2;
        for (let i = 0; i < availableMultipliers.length; i++) {
            if (rnd < weights[i]) {
                chosenMult = availableMultipliers[i];
                break;
            }
            rnd -= weights[i];
        }

        let rollCount = 0;
        const maxRolls = 14;
        const rollInterval = setInterval(() => {
            const tempM = availableMultipliers[rollCount % availableMultipliers.length];
            if (this.multiplierBadgeEl) {
                this.multiplierBadgeEl.textContent = `${tempM}×`;
                this.multiplierBadgeEl.classList.add('rolling');
            }
            window.soundEngine.playMultiplierTick();
            rollCount++;

            if (rollCount >= maxRolls) {
                clearInterval(rollInterval);
                this.lockMultiplier(chosenMult);
            }
        }, 65);
    }

    // 锁定倍率并点亮 12 落点中的随机灯格
    lockMultiplier(mult) {
        this.currentMultiplier = mult;
        if (this.multiplierBadgeEl) {
            this.multiplierBadgeEl.classList.remove('rolling');
            this.multiplierBadgeEl.classList.add('active');
            this.multiplierBadgeEl.textContent = `${mult}×`;
        }
        window.soundEngine.playMultiplierLocked(mult);

        // 倍率决定亮灯数：
        // 2× 亮 4 格、4× 亮 3 格、6× 亮 2 格、8×/10× 亮 1 格
        let litCount = 1;
        if (mult === 2) litCount = 4;
        else if (mult === 4) litCount = 3;
        else if (mult === 6) litCount = 2;
        else if (mult === 8 || mult === 10) litCount = 1;

        // 从 12 个落点中随机选取 litCount 个互不相同的槽位
        const indices = this.physics.slots.map(slot => slot.index);
        // Fisher-Yates 洗牌
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        this.litSlots = indices.slice(0, litCount);

        // 应用到物理引擎
        this.physics.setLitSlots(this.litSlots, mult);
        this.physics.randomizeHighElasticPins(8);

        // 将发射弹珠装填至弹簧位
        this.ensureBallStaged();

        this.gameState = 'READY_TO_LAUNCH';
        this.setStatus(`✨ 抽中 ${mult}× 倍率！点亮 ${litCount} 个灯格！发射前可继续追加投珠，或向下拉动拉杆发射！`, true);
        this.pulsePlunger();
    }

    ensureBallStaged() {
        const hasReadyBall = this.physics.balls.some(b => b.state === 'ready');
        if (!hasReadyBall) {
            this.physics.loadBall(this.currentSkin);
        }
    }

    highlightInsertBtn() {
        const btn = document.getElementById('btn-insert-ball');
        if (btn) {
            btn.classList.add('btn-attention');
            setTimeout(() => btn.classList.remove('btn-attention'), 1500);
        }
    }

    highlightAddBeadsBtn() {
        const btn = document.getElementById('btn-free-beads');
        if (btn) {
            btn.classList.add('btn-attention');
            setTimeout(() => btn.classList.remove('btn-attention'), 1500);
        }
    }

    pulsePlunger() {
        if (this.plungerKnob) {
            this.plungerKnob.classList.add('pulse');
            setTimeout(() => this.plungerKnob.classList.remove('pulse'), 1500);
        }
    }

    playInsertEffect() {
        if (!this.coinSlot) return;
        this.coinSlot.classList.remove('coin-slot-active');
        // Restart the short animation for rapid clicks/long presses.
        void this.coinSlot.offsetWidth;
        this.coinSlot.classList.add('coin-slot-active');
        setTimeout(() => this.coinSlot && this.coinSlot.classList.remove('coin-slot-active'), 360);
    }

    // 事件绑定
    initEventListeners() {
        const btnInsert = document.getElementById('btn-insert-ball');
        if (btnInsert) {
            // 点击 +1 且支持一直按住连续快速投珠
            const startHold = (e) => {
                e.preventDefault();
                this.insertSingleBall();
                clearTimeout(this.insertHoldTimer);
                clearInterval(this.insertHoldInterval);

                this.insertHoldTimer = setTimeout(() => {
                    this.insertHoldInterval = setInterval(() => {
                        const ok = this.insertSingleBall();
                        if (!ok) {
                            clearInterval(this.insertHoldInterval);
                        }
                    }, 65);
                }, 260);
            };

            const endHold = () => {
                clearTimeout(this.insertHoldTimer);
                clearInterval(this.insertHoldInterval);
            };

            btnInsert.addEventListener('mousedown', startHold);
            btnInsert.addEventListener('mouseup', endHold);
            btnInsert.addEventListener('mouseleave', endHold);

            btnInsert.addEventListener('touchstart', startHold, { passive: false });
            btnInsert.addEventListener('touchend', endHold);
            btnInsert.addEventListener('touchcancel', endHold);
        }

        document.querySelectorAll('.bet-quick-btn').forEach((button) => {
            button.addEventListener('click', () => {
                const count = parseInt(button.dataset.insertCount, 10);
                this.insertBalls(count);
            });
        });

        const btnStart = document.getElementById('btn-start-game');
        if (btnStart) {
            btnStart.addEventListener('click', () => this.onStartBtnClicked());
        }

        // 免费加珠 (密码 ma123456)
        const btnFree = document.getElementById('btn-free-beads');
        if (btnFree) {
            btnFree.addEventListener('click', () => this.openAddBeadsModal());
        }

        const btnShake = document.getElementById('btn-shake-machine');
        if (btnShake) btnShake.addEventListener('click', () => this.shakeMachine());

        const btnSetting = document.getElementById('btn-settings');
        if (btnSetting) btnSetting.addEventListener('click', () => this.openSettingsPasswordModal());

        const btnBackpack = document.getElementById('btn-backpack');
        if (btnBackpack) btnBackpack.addEventListener('click', () => this.openBackpackModal());

        const btnHome = document.getElementById('btn-home');
        if (btnHome) {
            btnHome.addEventListener('click', () => this.toggleFullscreen());
        }
        document.addEventListener('fullscreenchange', () => this.updateFullscreenButton());
        document.addEventListener('webkitfullscreenchange', () => this.updateFullscreenButton());

        if (this.catTray) {
            this.catTray.addEventListener('click', () => this.collectTrayBeads());
        }

        this.initPlungerControls();
        this.initKeyboardControls();
    }

    initPlungerControls() {
        const knob = this.plungerKnob;
        if (!knob) return;

        const onStart = (clientY) => {
            if (this.gameState !== 'READY_TO_LAUNCH') {
                if (this.currentMultiplier === 0) {
                    this.setStatus('⚠️ 请先投珠 5~99 颗并按【开始】确定倍率后再发射！', true);
                    return;
                }
            }
            this.isPullingPlunger = true;
            this.pullStartY = clientY;
            this.lastSoundPullDist = 0;
            knob.classList.add('active');
        };

        const onMove = (clientY) => {
            if (!this.isPullingPlunger) return;
            const deltaY = Math.max(0, Math.min(60, clientY - this.pullStartY));
            this.physics.setPlungerPull(deltaY);

            if (this.plungerSpringVisual) {
                const scale = 1 - (deltaY / 60) * 0.45;
                this.plungerSpringVisual.style.transform = `scaleY(${scale})`;
            }
            knob.style.transform = `translateY(${deltaY}px)`;

            if (deltaY - this.lastSoundPullDist > 8) {
                window.soundEngine.playSpringPull(deltaY / 60);
                this.lastSoundPullDist = deltaY;
            }
        };

        const onEnd = () => {
            if (!this.isPullingPlunger) return;
            this.isPullingPlunger = false;
            knob.classList.remove('active');

            this.physics.releasePlunger();

            knob.style.transform = 'translateY(0px)';
            if (this.plungerSpringVisual) {
                this.plungerSpringVisual.style.transform = 'scaleY(1)';
            }
        };

        knob.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onStart(e.clientY);
            const moveHandler = (me) => onMove(me.clientY);
            const upHandler = () => {
                onEnd();
                window.removeEventListener('mousemove', moveHandler);
                window.removeEventListener('mouseup', upHandler);
            };
            window.addEventListener('mousemove', moveHandler);
            window.addEventListener('mouseup', upHandler);
        });

        knob.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (e.touches.length > 0) onStart(e.touches[0].clientY);
        }, { passive: false });

        knob.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (e.touches.length > 0) onMove(e.touches[0].clientY);
        }, { passive: false });

        knob.addEventListener('touchend', (e) => {
            e.preventDefault();
            onEnd();
        });
    }

    initKeyboardControls() {
        let spacePressed = false;
        let spaceCharge = 0;
        let chargeTimer = null;

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !spacePressed) {
                if (document.querySelector('.modal.active')) return;
                if (this.gameState !== 'READY_TO_LAUNCH') {
                    if (this.currentMultiplier === 0) {
                        this.setStatus('⚠️ 请先投珠 5~99 颗并按【开始】确定倍率后再发射！', true);
                        return;
                    }
                }
                e.preventDefault();
                spacePressed = true;
                spaceCharge = 0;

                chargeTimer = setInterval(() => {
                    spaceCharge = Math.min(60, spaceCharge + 4);
                    this.physics.setPlungerPull(spaceCharge);
                    if (this.plungerKnob) {
                        this.plungerKnob.style.transform = `translateY(${spaceCharge}px)`;
                    }
                    window.soundEngine.playSpringPull(spaceCharge / 60);
                }, 35);
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space' && spacePressed) {
                e.preventDefault();
                spacePressed = false;
                clearInterval(chargeTimer);
                this.physics.releasePlunger();
                if (this.plungerKnob) {
                    this.plungerKnob.style.transform = 'translateY(0px)';
                }
            }
        });
    }

    handlePhysicsEvent(type, data) {
        if (type === 'pin_hit') {
            const now = performance.now();
            if (now - this.lastPinSoundAt > 55) {
                this.lastPinSoundAt = now;
                window.soundEngine.playPinHit(data.pitch);
            }
        } else if (type === 'plunger_release') {
            window.soundEngine.playSpringRelease(data.power);
            this.gameState = 'BALL_IN_PLAY';
            // Keep the playfield status area clear while the marble is moving.
            this.setStatus('');
        } else if (type === 'ball_returned') {
            this.gameState = 'READY_TO_LAUNCH';
            this.setStatus('');
        } else if (type === 'bumper_hit') {
            const now = performance.now();
            if (now - this.lastBumperSoundAt > 80) {
                this.lastBumperSoundAt = now;
                window.soundEngine.playPillarHit(data.isLeftBlocker);
            }
        } else if (type === 'slot_score') {
            this.resolveSlotScore(data.slot);
        } else if (type === 'ball_lost') {
            this.resolveBallLost();
        }
    }

    shakeMachine() {
        window.soundEngine.playBtnClick();
        const machine = document.querySelector('.arcade-cabinet');
        if (machine) {
            machine.classList.remove('shake');
            void machine.offsetWidth;
            machine.classList.add('shake');
            setTimeout(() => machine.classList.remove('shake'), 450);
        }
        const activeBall = this.physics.balls.find(ball => ball.state !== 'scored');
        if (activeBall) {
            activeBall.state = 'ready';
            activeBall.x = 372;
            activeBall.y = this.physics.plunger.restY - activeBall.radius;
            activeBall.vx = 0;
            activeBall.vy = 0;
            this.gameState = this.currentMultiplier > 0 ? 'READY_TO_LAUNCH' : 'IDLE';
        }
        this.setStatus('');
    }

    // 发射判定：落入亮灯格 vs 未亮灯格
    resolveSlotScore(slot) {
        this.gameState = 'RESOLVING';

        if (slot.isLit) {
            // 中奖返珠 = 倍率 × 投珠数
            const winBeads = this.currentMultiplier * this.currentBet;

            // 积分卡奖励：cards = min(floor(倍率 × 投珠 / T), J)
            const wonCards = Math.min(Math.floor(winBeads / this.configT), this.configJ);

            this.rewardBeads += winBeads;
            this.rewardScore += wonCards;
            this.totalScore += wonCards;
            this.updateHUD();

            window.soundEngine.playSlotWin(this.currentMultiplier);
            this.triggerScreenShake();
            this.setStatus(`🎉 中奖！落入亮灯格！返还 ${winBeads} 颗珠子 (${this.currentMultiplier}×${this.currentBet}) + ${wonCards} 张积分卡！`, true);

            // 触发托盘成串落球动画
            this.spawnTrayDrops(winBeads);
        } else {
            // 未亮灯格：全损！
            window.soundEngine.playLossSound();
            this.setStatus(`💔 未中奖！落入未亮灯格，投入的 ${this.currentBet} 颗珠子全损！`, true);
        }

        // 2.6秒后自动重置对局，并将奖励汇入总珠子
        setTimeout(() => {
            this.resetRound();
        }, 2600);
    }

    resolveBallLost() {
        this.gameState = 'RESOLVING';
        window.soundEngine.playLossSound();
        this.setStatus(`弹珠滑出盘面，本局结束。`);
        setTimeout(() => {
            this.resetRound();
        }, 1500);
    }

    resetRound() {
        this.collectTrayBeads();
        this.currentBet = 0;
        this.currentMultiplier = 0;
        this.litSlots = [];
        this.physics.clearLitSlots();
        this.gameState = 'IDLE';
        this.updateHUD();
        this.setStatus('等待开始 (请投入 5~99 颗弹珠开局)');
    }

    spawnTrayDrops(count) {
        const actualDropCount = Math.min(12, Math.max(3, Math.round(count / 3)));
        if (this.hopperExit) {
            this.hopperExit.classList.remove('hopper-active');
            void this.hopperExit.offsetWidth;
            this.hopperExit.classList.add('hopper-active');
            setTimeout(() => this.hopperExit && this.hopperExit.classList.remove('hopper-active'), actualDropCount * 110 + 700);
        }
        for (let i = 0; i < actualDropCount; i++) {
            setTimeout(() => {
                window.soundEngine.playBallDrop();
                const ballEl = document.createElement('div');
                ballEl.className = 'tray-drop-ball';
                if (this.currentSkin === 'gold') ballEl.classList.add('gold');
                if (this.currentSkin === 'neon') ballEl.classList.add('neon');

                const randomOffset = (Math.random() - 0.5) * 40;
                ballEl.style.left = `calc(50% + ${randomOffset}px)`;
                this.catTray.appendChild(ballEl);

                setTimeout(() => {
                    if (ballEl.parentNode) {
                        ballEl.parentNode.removeChild(ballEl);
                    }
                }, 2200);
            }, i * 110);
        }
    }

    collectTrayBeads() {
        if (this.rewardBeads > 0) {
            this.totalBeads += this.rewardBeads;
            this.rewardBeads = 0;
            this.updateHUD();
        }
    }

    triggerScreenShake() {
        const machine = document.querySelector('.arcade-cabinet');
        if (machine) {
            machine.classList.add('shake');
            setTimeout(() => machine.classList.remove('shake'), 450);
        }
    }

    // ==========================================
    // 免费加珠模块 (密码：ma123456)
    // ==========================================
    openAddBeadsModal() {
        window.soundEngine.playBtnClick();
        const modal = document.getElementById('add-beads-modal');
        const step1 = document.getElementById('add-beads-step1');
        const step2 = document.getElementById('add-beads-step2');
        const pwdInput = document.getElementById('add-beads-pwd');
        const errorMsg = document.getElementById('add-beads-error');
        const amountInput = document.getElementById('add-beads-amount');

        // 初始化到 Step 1
        step1.style.display = 'block';
        step2.style.display = 'none';
        pwdInput.value = '';
        errorMsg.style.display = 'none';
        if (amountInput) amountInput.value = '100';

        modal.classList.add('active');
        setTimeout(() => pwdInput.focus(), 150);
    }

    verifyPasswordAndNext() {
        const pwdInput = document.getElementById('add-beads-pwd');
        const errorMsg = document.getElementById('add-beads-error');
        const step1 = document.getElementById('add-beads-step1');
        const step2 = document.getElementById('add-beads-step2');
        const amountInput = document.getElementById('add-beads-amount');

        if (pwdInput.value === 'ma123456') {
            errorMsg.style.display = 'none';
            step1.style.display = 'none';
            step2.style.display = 'block';
            window.soundEngine.playBtnClick();
            setTimeout(() => amountInput.focus(), 100);
        } else {
            errorMsg.textContent = '密码错误！请输入正确的管理密码。';
            errorMsg.style.display = 'block';
            pwdInput.value = '';
            pwdInput.focus();
        }
    }

    confirmAddBeads() {
        const amountInput = document.getElementById('add-beads-amount');
        const addNum = parseInt(amountInput.value, 10);

        if (isNaN(addNum) || addNum <= 0) {
            alert('请输入大于 0 的有效珠子数量！');
            return;
        }

        this.totalBeads += addNum;
        this.updateHUD();
        window.soundEngine.playSlotWin(1);
        this.closeModal('add-beads-modal');
        this.setStatus(`✅ 成功添加 ${addNum} 颗弹珠！当前总珠子: ${this.totalBeads}`, true);
    }

    setQuickAddAmount(val) {
        const amountInput = document.getElementById('add-beads-amount');
        if (amountInput) {
            amountInput.value = val;
            window.soundEngine.playBtnClick();
        }
    }

    // 排行榜模态框
    openLeaderboardModal() {
        window.soundEngine.playBtnClick();
        const modal = document.getElementById('rank-modal');
        const myScoreEl = document.getElementById('my-rank-score');
        if (myScoreEl) myScoreEl.textContent = `${this.totalScore} 张卡`;
        modal.classList.add('active');
    }

    openSettingsPasswordModal() {
        window.soundEngine.playBtnClick();
        const modal = document.getElementById('settings-password-modal');
        const input = document.getElementById('settings-pwd');
        const error = document.getElementById('settings-pwd-error');
        if (!modal || !input) return this.openSettingsModal();
        input.value = '';
        if (error) error.style.display = 'none';
        modal.classList.add('active');
        setTimeout(() => input.focus(), 120);
    }

    verifySettingsPassword() {
        const input = document.getElementById('settings-pwd');
        const error = document.getElementById('settings-pwd-error');
        if (input && input.value === 'ma123456') {
            this.closeModal('settings-password-modal');
            this.openSettingsModal();
        } else if (error) {
            error.textContent = '密码错误！请输入正确的管理密码。';
            error.style.display = 'block';
            if (input) { input.value = ''; input.focus(); }
        }
    }

    populateGlobalSettingsFields() {
        const soundToggle = document.getElementById('toggle-sound');
        const inputT = document.getElementById('config-param-t');
        const inputJ = document.getElementById('config-param-j');
        const probabilityInputs = [2, 4, 6, 8, 10].map(m => document.getElementById(`prob-mult-${m}`));

        if (soundToggle) soundToggle.checked = window.soundEngine.enabled;
        if (inputT) inputT.value = this.configT;
        if (inputJ) inputJ.value = this.configJ;
        probabilityInputs.forEach((input, index) => {
            if (input) input.value = this.multiplierProbabilities[index];
        });
    }

    // 设置模态框 (全局规则 + 当前机器弹珠/积分)
    openSettingsModal() {
        window.soundEngine.playBtnClick();
        const modal = document.getElementById('setting-modal');
        const inputBeads = document.getElementById('config-total-beads');
        const inputScore = document.getElementById('config-total-score');

        this.populateGlobalSettingsFields();
        if (inputBeads) inputBeads.value = this.totalBeads;
        if (inputScore) inputScore.value = this.totalScore;

        modal.classList.add('active');
    }

    async saveSettings() {
        const inputT = document.getElementById('config-param-t');
        const inputJ = document.getElementById('config-param-j');
        const soundToggle = document.getElementById('toggle-sound');
        const inputBeads = document.getElementById('config-total-beads');
        const inputScore = document.getElementById('config-total-score');
        const probabilityInputs = [2, 4, 6, 8, 10].map(m => document.getElementById(`prob-mult-${m}`));

        const nextT = inputT ? parseInt(inputT.value, 10) : this.configT;
        const nextJ = inputJ ? parseInt(inputJ.value, 10) : this.configJ;
        const nextBeads = inputBeads ? parseInt(inputBeads.value, 10) : this.totalBeads;
        const nextScore = inputScore ? parseInt(inputScore.value, 10) : this.totalScore;
        if (!Number.isInteger(nextT) || nextT <= 0 || !Number.isInteger(nextJ) || nextJ <= 0 ||
            !Number.isInteger(nextBeads) || nextBeads < 0 || !Number.isInteger(nextScore) || nextScore < 0) {
            alert('参数 T、J 必须大于 0，弹珠和积分数量必须是大于等于 0 的整数。');
            return;
        }

        const nextProbabilities = probabilityInputs.map(input => input ? Number(input.value) : NaN);
        const probabilityTotal = nextProbabilities.reduce((sum, value) => sum + value, 0);
        if (nextProbabilities.some(value => !Number.isFinite(value) || value < 0) || Math.abs(probabilityTotal - 100) > 0.01) {
            alert(`倍率概率总和必须为 100%，当前为 ${Number.isFinite(probabilityTotal) ? probabilityTotal.toFixed(1) : '无效'}%。`);
            return;
        }
        this.configT = nextT;
        this.configJ = nextJ;
        this.totalBeads = nextBeads;
        this.totalScore = nextScore;
        this.multiplierProbabilities = nextProbabilities;
        window.soundEngine.enabled = soundToggle ? soundToggle.checked : window.soundEngine.enabled;
        const syncedToServer = await this.saveGlobalConfig(this.getGlobalConfig());

        this.updateHUD();
        this.closeModal('setting-modal');
        const syncMessage = syncedToServer
            ? '全部机器配置已同步'
            : '配置已保存；使用共享服务启动后可同步到不同机器';
        this.setStatus(`${syncMessage} (T=${this.configT}, J=${this.configJ})；弹珠和积分仅更新当前机器`, true);
    }

    toggleFullscreen() {
        window.soundEngine.playBtnClick();
        const activeElement = document.fullscreenElement || document.webkitFullscreenElement;
        if (activeElement) {
            const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
            if (exitFullscreen) exitFullscreen.call(document);
            return;
        }

        const root = document.documentElement;
        const requestFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!requestFullscreen) {
            this.setStatus('当前浏览器不支持全屏游玩', true);
            return;
        }
        const result = requestFullscreen.call(root);
        if (result && typeof result.catch === 'function') {
            result.catch(() => this.setStatus('无法进入全屏，请检查浏览器权限', true));
        }
    }

    updateFullscreenButton() {
        const button = document.getElementById('btn-home');
        if (!button) return;
        const label = button.querySelector('span');
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
        button.title = isFullscreen ? '退出全屏' : '全屏游玩';
        if (label) label.textContent = isFullscreen ? '退出全屏' : '全屏';
    }

    openBackpackModal() {
        window.soundEngine.playBtnClick();
        const modal = document.getElementById('backpack-modal');
        modal.classList.add('active');
    }

    closeModal(id) {
        window.soundEngine.playBtnClick();
        const modal = document.getElementById(id);
        if (modal) modal.classList.remove('active');
    }

    setSkin(skinName) {
        window.soundEngine.playBtnClick();
        this.currentSkin = skinName;
        localStorage.setItem('hpb_ball_skin', skinName);
        this.setStatus(`已装备弹珠皮肤: ${skinName.toUpperCase()}`);
        this.closeModal('backpack-modal');
    }

    resetData() {
        if (confirm('确定要将当前机器的弹珠和积分重置为 0 吗？其他机器和全局配置不会受影响。')) {
            this.totalScore = 0;
            this.totalBeads = 0;
            this.rewardBeads = 0;
            this.rewardScore = 0;
            this.currentBet = 0;
            this.currentMultiplier = 0;
            this.physics.clearLitSlots();
            this.updateHUD();
            this.closeModal('setting-modal');
            this.setStatus('当前机器的弹珠和积分已重置为 0');
        }
    }

    loop(currentTime) {
        const dt = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        this.physics.update(dt);
        this.physics.render();

        requestAnimationFrame(this.loop.bind(this));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.game = new PinballGame();
});
