/**
 * HappyPinballGame - 主游戏控制与业务逻辑 V3.0
 * 1. 免费加珠：输入密码 ma123456 后设定添加珠子数量
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
        this.highElasticEnabled = localStorage.getItem('hpb_high_elastic_enabled') !== 'false';
        this.gameState = 'IDLE'; // IDLE, MULTIPLIER_ROLLING, READY_TO_LAUNCH, BALL_IN_PLAY, RESOLVING

        // Fever 狂欢多球
        this.feverEnergy = Math.min(99.75, parseFloat(localStorage.getItem('hpb_fever_energy') || '0') || 0);
        this.feverActive = false;
        this.feverTimeLeft = 0;
        this.feverDuration = 10;
        this.feverMultiplier = 10;
        this.feverLitCount = 6;
        this.feverSpawnTotal = 0;
        this.feverSpawned = 0;
        this.feverSpawnTimer = 0;
        this.feverSpawnInterval = 0.08;
        this.feverWinBeads = 0;
        this.feverScoredCount = 0;
        this.feverRoundGain = 0;
        this.feverRoundGainCap = 3;
        this.preFeverLitSlots = [];
        this.preFeverMultiplier = 0;
        this.pendingRoundReset = false;

        // 猫咪拉霸：每中奖 10 次触发
        this.catSlotSymbols = [
            { id: 'fish', icon: '🐟', name: '小鱼' },
            { id: 'cat', icon: '🐱', name: '猫咪' },
            { id: 'yarn', icon: '🧶', name: '毛线' }
        ];
        this.slotWinNeed = 10;
        this.slotWinCount = Math.min(
            this.slotWinNeed - 1,
            Math.max(0, parseInt(localStorage.getItem('hpb_slot_win_count') || '0', 10) || 0)
        );
        this.pendingCatSlot = false;
        this.catSlotSpinning = false;
        this.catSlotTimers = [];
        this.isFreeLaunch = false;
        this.freeLaunchBet = 5;

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
        this.syncHighElasticToggle();
        this.updateHUD();
        this.updateFeverUI();
        this.updateSlotProgressUI();

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
            if (this.feverActive) {
                this.multiplierBadgeEl.textContent = `${this.feverMultiplier}×`;
                this.multiplierBadgeEl.classList.add('active');
            } else if (this.currentMultiplier > 0) {
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
        if (this.isFreeLaunch) {
            this.setStatus('🎁 免费发射中，直接拉动拉杆！', true);
            return false;
        }
        if (this.feverActive || this.gameState === 'CAT_SLOT' || this.gameState === 'BALL_IN_PLAY' || this.gameState === 'RESOLVING' || this.gameState === 'MULTIPLIER_ROLLING') {
            return false;
        }

        if (this.totalBeads <= 0) {
            this.setStatus('⚠️ 珠子不足！请点击【加珠】输入密码补充', true);
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

        if (this.feverActive || this.gameState === 'CAT_SLOT' || this.gameState === 'BALL_IN_PLAY' || this.gameState === 'RESOLVING' || this.gameState === 'MULTIPLIER_ROLLING') {
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
        this.applyHighElasticPins();

        // 将发射弹珠装填至弹簧位
        this.ensureBallStaged();

        this.gameState = 'READY_TO_LAUNCH';
        if (this.isFreeLaunch) {
            this.setStatus(`🎁 免费 ${mult}× 发射！不扣珠子，点亮 ${litCount} 个灯格，拉动拉杆开打！`, true);
        } else {
            this.setStatus(`✨ 抽中 ${mult}× 倍率！点亮 ${litCount} 个灯格！发射前可继续追加投珠，或向下拉动拉杆发射！`, true);
        }
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

        const slotLever = document.getElementById('cat-slot-lever');
        if (slotLever) {
            slotLever.addEventListener('click', () => this.spinCatSlot());
        }

        const highElasticToggle = document.getElementById('toggle-high-elastic');
        if (highElasticToggle) {
            highElasticToggle.addEventListener('change', () => {
                this.setHighElasticEnabled(highElasticToggle.checked);
            });
        }

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
            if (this.feverActive) {
                this.setStatus('🔥 Fever 狂欢中，弹珠雨进行时！', true);
                return;
            }
            if (this.gameState === 'CAT_SLOT') {
                this.setStatus('🎰 猫咪拉霸进行中…', true);
                return;
            }
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
                if (this.feverActive) {
                    this.setStatus('🔥 Fever 狂欢中，弹珠雨进行时！', true);
                    return;
                }
                if (this.gameState === 'CAT_SLOT') {
                    this.setStatus('🎰 猫咪拉霸进行中…', true);
                    return;
                }
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
            const soundGap = this.feverActive ? 28 : 55;
            if (now - this.lastPinSoundAt > soundGap) {
                this.lastPinSoundAt = now;
                window.soundEngine.playPinHit(data.pitch);
            }
            if (!this.feverActive && !data.isFeverBall) {
                this.addFeverEnergy(0.1);
            }
        } else if (type === 'plunger_release') {
            window.soundEngine.playSpringRelease(data.power);
            this.gameState = 'BALL_IN_PLAY';
            // Keep the playfield status area clear while the marble is moving.
            this.setStatus('');
        } else if (type === 'ball_returned') {
            if (data.ball && data.ball.isFever) return;
            this.gameState = 'READY_TO_LAUNCH';
            this.setStatus('');
        } else if (type === 'bumper_hit') {
            const now = performance.now();
            if (now - this.lastBumperSoundAt > 80) {
                this.lastBumperSoundAt = now;
                window.soundEngine.playPillarHit(data.isLeftBlocker);
            }
        } else if (type === 'slot_score') {
            if (data.ball && data.ball.isFever) {
                this.resolveFeverBallScore(data.slot);
            } else {
                this.resolveSlotScore(data.slot);
            }
        } else if (type === 'ball_lost') {
            if (data.ball && data.ball.isFever) return;
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
        this.physics.shakeActiveBall();
    }

    // 发射判定：落入亮灯格 vs 未亮灯格
    resolveSlotScore(slot) {
        this.gameState = 'RESOLVING';
        const scoreMultiplier = this.feverActive ? this.feverMultiplier : this.currentMultiplier;

        if (slot.isLit) {
            // 中奖返珠 = 倍率 × 投珠数
            const winBeads = scoreMultiplier * this.currentBet;

            // 积分卡奖励：cards = min(floor(倍率 × 投珠 / T), J)
            const wonCards = Math.min(Math.floor(winBeads / this.configT), this.configJ);

            this.rewardBeads += winBeads;
            this.rewardScore += wonCards;
            this.totalScore += wonCards;
            this.updateHUD();

            window.soundEngine.playSlotWin(scoreMultiplier);
            this.triggerScreenShake();
            this.registerLitWin();
            this.setStatus(`🎉 中奖！落入亮灯格！返还 ${winBeads} 颗珠子 (${scoreMultiplier}×${this.currentBet}) + ${wonCards} 张积分卡！`, true);

            // 触发托盘成串落球动画
            this.spawnTrayDrops(winBeads);
        } else {
            // 未亮灯格：全损！
            window.soundEngine.playLossSound();
            const lossMessage = this.isFreeLaunch
                ? '🎁 免费发射未中奖，珠子无损失！'
                : `💔 未中奖！落入未亮灯格，投入的 ${this.currentBet} 颗珠子全损！`;
            this.setStatus(lossMessage, true);
            this.finishRoundAfterScore(0);
            this.setStatus(lossMessage, true);
            return;
        }

        this.finishRoundAfterScore(2600);
    }

    resolveFeverBallScore(slot) {
        if (!slot.isLit) return;
        const beads = this.feverMultiplier;
        this.feverWinBeads += beads;
        this.feverScoredCount += 1;
        this.rewardBeads += beads;
        this.updateHUD();
        window.soundEngine.playFeverScore();
    }

    resolveBallLost() {
        this.gameState = 'RESOLVING';
        window.soundEngine.playLossSound();
        this.setStatus(`弹珠滑出盘面，本局结束。`);
        this.finishRoundAfterScore(0);
        this.setStatus(`弹珠滑出盘面，本局结束。`);
    }

    finishRoundAfterScore(delayMs) {
        if (this.feverActive) {
            this.pendingRoundReset = true;
            return;
        }
        if (delayMs > 0) {
            setTimeout(() => {
                if (!this.feverActive) this.resetRound();
                else this.pendingRoundReset = true;
            }, delayMs);
            return;
        }
        this.resetRound();
    }

    resetRound() {
        if (this.feverActive) {
            this.pendingRoundReset = true;
            return;
        }
        this.collectTrayBeads();
        this.currentBet = 0;
        this.currentMultiplier = 0;
        this.litSlots = [];
        this.isFreeLaunch = false;
        this.feverRoundGain = 0;
        this.physics.clearLitSlots();
        this.updateHUD();

        if (this.pendingCatSlot) {
            this.pendingCatSlot = false;
            this.startCatSlot();
            return;
        }

        this.gameState = 'IDLE';
        this.setStatus('等待开始 (请投入 5~99 颗弹珠开局)');
    }

    syncHighElasticToggle() {
        const toggle = document.getElementById('toggle-high-elastic');
        const switchEl = document.getElementById('high-elastic-switch');
        if (toggle) toggle.checked = this.highElasticEnabled;
        if (switchEl) switchEl.classList.toggle('is-on', this.highElasticEnabled);
    }

    setHighElasticEnabled(enabled) {
        this.highElasticEnabled = !!enabled;
        localStorage.setItem('hpb_high_elastic_enabled', this.highElasticEnabled ? 'true' : 'false');
        this.syncHighElasticToggle();
        this.applyHighElasticPins();
        window.soundEngine.playBtnClick();
        this.setStatus(this.highElasticEnabled ? '高弹已开启：本局随机 8 颗高弹力钉' : '高弹已关闭', true);
    }

    applyHighElasticPins() {
        if (this.highElasticEnabled) {
            this.physics.randomizeHighElasticPins(8);
        } else {
            this.physics.clearHighElasticPins();
        }
    }

    registerLitWin() {
        this.slotWinCount += 1;
        if (this.slotWinCount >= this.slotWinNeed) {
            this.slotWinCount = 0;
            this.pendingCatSlot = true;
        }
        localStorage.setItem('hpb_slot_win_count', String(this.slotWinCount));
        this.updateSlotProgressUI();
    }

    updateSlotProgressUI() {
        const fill = document.getElementById('slot-progress-fill');
        const text = document.getElementById('slot-progress-text');
        const bar = document.getElementById('slot-progress');
        if (fill) fill.style.width = `${(this.slotWinCount / this.slotWinNeed) * 100}%`;
        if (text) text.textContent = `${this.slotWinCount}/${this.slotWinNeed}`;
        if (bar) bar.classList.toggle('is-hot', this.slotWinCount >= this.slotWinNeed - 1);
    }

    clearCatSlotTimers() {
        this.catSlotTimers.forEach((id) => {
            clearTimeout(id);
            clearInterval(id);
        });
        this.catSlotTimers = [];
    }

    startCatSlot() {
        this.gameState = 'CAT_SLOT';
        this.catSlotSpinning = false;
        this.clearCatSlotTimers();

        const panel = document.getElementById('dashboard-panel');
        const result = document.getElementById('cat-slot-result');
        const lever = document.getElementById('cat-slot-lever');
        if (panel) panel.classList.add('slot-active');
        if (result) result.textContent = '中奖满 10 次！5 秒后自动开摇，也可提前拉杆';
        [0, 1, 2].forEach((i) => {
            const reel = document.getElementById(`slot-symbol-${i}`);
            const cell = reel && reel.closest('.cat-slot-reel');
            if (reel) reel.textContent = this.catSlotSymbols[i].icon;
            if (cell) cell.classList.remove('spinning', 'stopped', 'jackpot');
        });
        if (lever) lever.classList.remove('pulling');

        this.setStatus('🎰 猫咪拉霸启动！三连大奖，两连有奖！', true);
        window.soundEngine.playSlotFanfare();
        const auto = setTimeout(() => this.spinCatSlot(), 5000);
        this.catSlotTimers.push(auto);
    }

    spinCatSlot() {
        if (this.gameState !== 'CAT_SLOT' || this.catSlotSpinning) return;
        this.catSlotSpinning = true;
        this.clearCatSlotTimers();

        const lever = document.getElementById('cat-slot-lever');
        const result = document.getElementById('cat-slot-result');
        if (lever) {
            lever.classList.remove('pulling');
            void lever.offsetWidth;
            lever.classList.add('pulling');
        }
        if (result) result.textContent = '滚轮旋转中…';
        window.soundEngine.playSlotPull();

        const finalSymbols = [0, 1, 2].map(() =>
            this.catSlotSymbols[Math.floor(Math.random() * this.catSlotSymbols.length)]
        );

        [0, 1, 2].forEach((reelIndex) => {
            const symbolEl = document.getElementById(`slot-symbol-${reelIndex}`);
            const cell = symbolEl && symbolEl.closest('.cat-slot-reel');
            if (cell) {
                cell.classList.remove('stopped', 'jackpot');
                cell.classList.add('spinning');
            }
            const tick = setInterval(() => {
                const rnd = this.catSlotSymbols[Math.floor(Math.random() * this.catSlotSymbols.length)];
                if (symbolEl) symbolEl.textContent = rnd.icon;
                if (reelIndex === 0) window.soundEngine.playSlotReelTick();
            }, 70);
            this.catSlotTimers.push(tick);

            const stopAt = 720 + reelIndex * 420;
            const stopTimer = setTimeout(() => {
                clearInterval(tick);
                if (symbolEl) symbolEl.textContent = finalSymbols[reelIndex].icon;
                if (cell) {
                    cell.classList.remove('spinning');
                    cell.classList.add('stopped');
                }
                window.soundEngine.playSlotReelStop();
                if (reelIndex === 2) this.resolveCatSlot(finalSymbols);
            }, stopAt);
            this.catSlotTimers.push(stopTimer);
        });
    }

    resolveCatSlot(symbols) {
        const counts = {};
        symbols.forEach((s) => {
            counts[s.id] = (counts[s.id] || 0) + 1;
        });
        let matchId = null;
        let matchCount = 1;
        Object.keys(counts).forEach((id) => {
            if (counts[id] > matchCount) {
                matchCount = counts[id];
                matchId = id;
            }
        });

        const result = document.getElementById('cat-slot-result');
        const lever = document.getElementById('cat-slot-lever');
        if (lever) lever.classList.remove('pulling');

        if (matchCount === 3) {
            [0, 1, 2].forEach((i) => {
                const cell = document.getElementById(`slot-symbol-${i}`)?.closest('.cat-slot-reel');
                if (cell) cell.classList.add('jackpot');
            });
            window.soundEngine.playSlotJackpot();
            this.awardCatSlotPrize(matchId, 3, result);
        } else if (matchCount === 2) {
            window.soundEngine.playSlotPairWin();
            this.awardCatSlotPrize(matchId, 2, result);
        } else {
            window.soundEngine.playSlotMiss();
            if (result) result.textContent = '没中图案，下次再来！';
            this.setStatus('🎰 拉霸未中，仪表板恢复。', true);
            const done = setTimeout(() => this.closeCatSlot(), 1600);
            this.catSlotTimers.push(done);
        }
    }

    awardCatSlotPrize(symbolId, matchCount, resultEl) {
        const isTriple = matchCount === 3;
        let message = '';

        if (symbolId === 'fish') {
            const beads = isTriple ? 20 : 10;
            this.rewardBeads += beads;
            this.updateHUD();
            this.spawnTrayDrops(beads);
            message = `${isTriple ? '三连' : '两连'} 🐟！额外 ${beads} 颗珠子！`;
            if (resultEl) resultEl.textContent = message;
            this.setStatus(`🎰 ${message}`, true);
            const done = setTimeout(() => this.closeCatSlot(), 3800);
            this.catSlotTimers.push(done);
            return;
        }

        if (symbolId === 'cat') {
            const cards = isTriple ? 2 : 1;
            this.rewardScore += cards;
            this.totalScore += cards;
            this.updateHUD();
            message = `${isTriple ? '三连' : '两连'} 🐱！额外 ${cards} 张积分卡！`;
            if (resultEl) resultEl.textContent = message;
            this.setStatus(`🎰 ${message}`, true);
            const done = setTimeout(() => this.closeCatSlot(), 3800);
            this.catSlotTimers.push(done);
            return;
        }

        const launchMult = isTriple ? 10 : 2;
        message = `${isTriple ? '三连' : '两连'} 🧶！送一次免费 ${launchMult}× 发射！`;
        if (resultEl) resultEl.textContent = message;
        this.setStatus(`🎰 ${message}`, true);
        const done = setTimeout(() => {
            this.closeCatSlot();
            this.grantFreeLaunch(launchMult);
        }, 3800);
        this.catSlotTimers.push(done);
    }

    closeCatSlot() {
        this.clearCatSlotTimers();
        this.catSlotSpinning = false;
        const panel = document.getElementById('dashboard-panel');
        if (panel) panel.classList.remove('slot-active');
        if (this.gameState === 'CAT_SLOT') {
            this.gameState = 'IDLE';
            this.setStatus('等待开始 (请投入 5~99 颗弹珠开局)');
        }
        this.updateSlotProgressUI();
    }

    grantFreeLaunch(mult) {
        this.isFreeLaunch = true;
        this.currentBet = this.freeLaunchBet;
        this.lockMultiplier(mult);
        this.updateHUD();
        this.setStatus(`🎁 免费 ${mult}× 发射已就绪！不扣珠子，拉动拉杆开打！`, true);
    }

    addFeverEnergy(amount) {
        if (this.feverActive) return;
        const remaining = this.feverRoundGainCap - this.feverRoundGain;
        if (remaining <= 0) return;
        const actual = Math.min(amount, remaining);
        if (actual <= 0) return;
        this.feverRoundGain += actual;
        this.feverEnergy = Math.min(100, this.feverEnergy + actual);
        localStorage.setItem('hpb_fever_energy', String(this.feverEnergy));
        this.updateFeverUI();
        if (this.feverEnergy >= 100) this.startFever();
    }

    updateFeverUI() {
        const gauge = document.getElementById('fever-gauge');
        const fill = document.getElementById('fever-gauge-fill');
        const pct = document.getElementById('fever-gauge-pct');
        const tag = document.getElementById('fever-gauge-tag');
        if (!gauge || !fill || !pct) return;

        gauge.classList.toggle('is-active', this.feverActive);
        gauge.classList.toggle('is-hot', !this.feverActive && this.feverEnergy >= 80);

        if (this.feverActive) {
            const remain = Math.max(0, this.feverTimeLeft);
            fill.style.width = `${(remain / this.feverDuration) * 100}%`;
            pct.textContent = `${remain.toFixed(1)}s`;
            if (tag) tag.textContent = 'FEVER';
        } else {
            fill.style.width = `${this.feverEnergy}%`;
            pct.textContent = `${this.feverEnergy.toFixed(1)}%`;
            if (tag) tag.textContent = 'FEVER';
        }
    }

    startFever() {
        if (this.feverActive) return;
        this.feverActive = true;
        this.feverEnergy = 0;
        localStorage.setItem('hpb_fever_energy', '0');
        this.feverTimeLeft = this.feverDuration;
        this.feverSpawnTotal = 10 + Math.floor(Math.random() * 6);
        this.feverSpawned = 0;
        this.feverSpawnTimer = this.feverSpawnInterval;
        this.feverWinBeads = 0;
        this.feverScoredCount = 0;
        this.preFeverLitSlots = [...this.litSlots];
        this.preFeverMultiplier = this.currentMultiplier;

        const indices = this.physics.slots.map(slot => slot.index);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        const feverLit = indices.slice(0, Math.min(this.feverLitCount, indices.length));
        this.physics.setLitSlots(feverLit, this.feverMultiplier);
        this.physics.feverActive = true;

        const playfield = document.getElementById('playfield-container');
        const overlay = document.getElementById('fever-overlay');
        const cabinet = document.querySelector('.arcade-cabinet');
        if (playfield) playfield.classList.add('fever-mode');
        if (overlay) overlay.classList.add('active');
        if (cabinet) cabinet.classList.add('fever-mode');

        if (this.multiplierBadgeEl) {
            this.multiplierBadgeEl.textContent = `${this.feverMultiplier}×`;
            this.multiplierBadgeEl.classList.add('active', 'rolling');
        }

        for (let i = 0; i < 9; i++) {
            this.physics.createSparks(28 + i * 36, 42, 10, i % 2 === 0 ? '#ffeb3b' : '#ff1744');
        }
        window.soundEngine.playFeverStart();
        window.soundEngine.startFeverLoop();
        this.triggerScreenShake();
        this.setStatus(`🔥 FEVER 狂欢！随机 ${feverLit.length} 孔 ${this.feverMultiplier}× 亮灯，弹珠雨 ${this.feverSpawnTotal} 颗！`, true);
        this.updateFeverUI();
    }

    updateFever(dt) {
        if (!this.feverActive) return;

        this.feverTimeLeft -= dt;
        if (this.feverSpawned < this.feverSpawnTotal) {
            this.feverSpawnTimer += dt;
            let spawnedThisFrame = 0;
            while (
                this.feverSpawnTimer >= this.feverSpawnInterval &&
                this.feverSpawned < this.feverSpawnTotal &&
                spawnedThisFrame < 2
            ) {
                this.feverSpawnTimer -= this.feverSpawnInterval;
                this.physics.spawnFeverBall(this.currentSkin);
                this.feverSpawned += 1;
                spawnedThisFrame += 1;
                window.soundEngine.playFeverDrop();
            }
        }

        this.updateFeverUI();

        const overtime = this.feverTimeLeft <= -4;
        const timeUp = this.feverTimeLeft <= 0;
        if (timeUp && (!this.physics.hasFeverBalls() || overtime)) {
            this.endFever();
        }
    }

    endFever() {
        if (!this.feverActive) return;
        this.feverActive = false;
        this.physics.feverActive = false;
        this.physics.removeFeverBalls();
        window.soundEngine.stopFeverLoop();
        window.soundEngine.playFeverEnd();

        const playfield = document.getElementById('playfield-container');
        const overlay = document.getElementById('fever-overlay');
        const cabinet = document.querySelector('.arcade-cabinet');
        if (playfield) playfield.classList.remove('fever-mode');
        if (overlay) overlay.classList.remove('active');
        if (cabinet) cabinet.classList.remove('fever-mode');
        if (this.multiplierBadgeEl) this.multiplierBadgeEl.classList.remove('rolling');

        if (this.gameState === 'READY_TO_LAUNCH' || this.gameState === 'BALL_IN_PLAY') {
            this.physics.setLitSlots(this.preFeverLitSlots, this.preFeverMultiplier || this.currentMultiplier);
            this.litSlots = [...this.preFeverLitSlots];
        } else if (!this.pendingRoundReset) {
            this.physics.clearLitSlots();
        }

        const beads = this.feverWinBeads;
        this.updateHUD();
        if (beads > 0) this.spawnTrayDrops(beads);

        this.setStatus(
            `Fever 结束！${this.feverScoredCount} 颗狂欢珠入孔，奖励 ${beads} 珠（不计积分卡）！`,
            true
        );
        this.updateFeverUI();

        if (this.pendingRoundReset) {
            this.pendingRoundReset = false;
            setTimeout(() => this.resetRound(), 900);
        } else {
            this.updateHUD();
        }
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
            if (this.feverActive) {
                this.pendingRoundReset = false;
                this.endFever();
            }
            this.feverEnergy = 0;
            this.feverRoundGain = 0;
            localStorage.setItem('hpb_fever_energy', '0');
            this.updateFeverUI();
            this.slotWinCount = 0;
            this.pendingCatSlot = false;
            this.isFreeLaunch = false;
            localStorage.setItem('hpb_slot_win_count', '0');
            this.closeCatSlot();
            this.updateSlotProgressUI();
            this.updateHUD();
            this.closeModal('setting-modal');
            this.setStatus('当前机器的弹珠和积分已重置为 0');
        }
    }

    loop(currentTime) {
        const dt = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        this.updateFever(dt);
        this.physics.update(dt);
        this.physics.render();

        requestAnimationFrame(this.loop.bind(this));
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.game = new PinballGame();
});
