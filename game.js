/**
 * HappyPinballGame - 主游戏控制与业务逻辑 V3.0
 * 1. 免费加珠：输入管理密码后按用户名给指定账户添加珠子（密码可在设置中修改）
 * 2. 5~99 投珠开局，按开始确定倍率 (2×/4×/6×/8×/10×)，按倍率点亮 12 落点对应灯格
 * 3. 亮灯后发射前可追加投珠 (上限 99)
 * 4. 中奖返珠 = 倍率 × 投珠，积分卡 = min(floor(返珠 / T), J)
 * 5. 点击投珠 +1、快捷投珠 +5/+10，长按高速连续投珠
 * 6. 输入用户名进入账户，积分和弹珠跟随账户保存在服务器，换浏览器可继续玩
 * 7. 定投模式：每局自动投入设定珠数，可选自动开始并满力发射
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

        // 账户数据（登录后从服务器/本地账户读取）
        this.totalScore = 0;
        this.totalBeads = 0;
        this.rewardBeads = 0;
        this.rewardScore = 0;
        this.currentUsername = null;
        this.accountUpdatedAt = 0;
        this.accountDirty = false;
        this.accountSaveTimer = null;
        this.accountPollTimer = null;
        this.accountSaving = false;
        this.accountLoading = false;
        this.usingServerAccounts = false;
        this.accountNameLabelEl = document.getElementById('account-name-label');
        this.accountSyncHintEl = document.getElementById('account-sync-hint');
        this.lastUsernameStorageKey = 'hpb_last_username';
        this.localAccountsStorageKey = 'hpb_accounts_v1';
        this.accountMigratedStorageKey = 'hpb_account_migrated_v1';

        // 全局规则由所有机器共享；弹珠和积分仍保存在当前机器。
        this.globalConfigStorageKey = 'hpb_global_config_v1';
        this.globalConfigChannel = this.createGlobalConfigChannel();
        this.highElasticEnabled = true;
        this.applyGlobalConfig(this.loadGlobalConfig());

        // 对局状态
        this.currentBet = 0; // 当前投入珠子 (5 ~ 99)
        this.currentMultiplier = 0; // 锁定倍率 (2, 4, 6, 8, 10)
        this.litSlots = []; // 当前点亮的落点槽位索引
        this.currentSkin = localStorage.getItem('hpb_ball_skin') || 'classic';
        this.gameState = 'IDLE'; // IDLE, MULTIPLIER_ROLLING, READY_TO_LAUNCH, BALL_IN_PLAY, RESOLVING

        // Fever 狂欢多球
        this.feverEnergy = Math.min(99.75, parseFloat(localStorage.getItem('hpb_fever_energy') || '0') || 0);
        this.feverActive = false;
        this.feverTimeLeft = 0;
        this.feverDuration = 10;
        this.feverMultiplier = 2;
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
        this.pendingFever = false;

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

        // 定投模式（保存在本地）
        this.autoInvestStorageKey = 'hpb_auto_invest_v1';
        this.autoInvestEnabled = false;
        this.autoInvestAmount = 10;
        this.autoStartEnabled = false;
        this.autoInvestPaused = false;
        this.autoInvestRunning = false;
        this.autoInvestAnimValue = null;
        this.autoInvestTimer = null;
        this.autoInvestAnimFrame = null;
        this.autoLaunchTimer = null;
        this.autoLaunchFrame = null;
        this.autoInvestSettleDelayMs = 400;
        this.autoInvestRollMs = 200;
        this.autoLaunchAfterLockMs = 280;
        this.autoLaunchPullMs = 160;
        this.loadAutoInvestSettings();

        // 拉杆拖拽状态
        this.isPullingPlunger = false;
        this.pullStartY = 0;
        this.lastSoundPullDist = 0;
        this.lastPinSoundAt = 0;
        this.lastBumperSoundAt = 0;

        this.initUI();
        this.initEventListeners();
        this.initGlobalConfigSync();
        this.initAccountSystem();
        this.updateHUD();
        this.updateFeverUI();
        this.updateSlotProgressUI();

        // 启动主循环
        this.lastTime = performance.now();
        requestAnimationFrame(this.loop.bind(this));
    }

    initUI() {
        this.updateHUD();
        this.updateAutoInvestButton();
        this.setStatus('等待开始 (请投入 5~99 颗弹珠开局)');
    }

    updateHUD(options = {}) {
        const persist = options.persist !== false;
        this.totalScoreEl.textContent = this.totalScore;
        this.totalBeadsEl.textContent = this.totalBeads;
        this.rewardBeadsEl.textContent = this.rewardBeads;
        this.rewardScoreEl.textContent = this.rewardScore;

        if (this.loadedCountEl) {
            const display = this.autoInvestAnimValue != null ? this.autoInvestAnimValue : this.currentBet;
            this.loadedCountEl.textContent = `${display}`;
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

        if (persist && this.currentUsername) this.persistCurrentAccount(false);
    }

    getDefaultGlobalConfig() {
        return {
            soundEnabled: true,
            highElasticEnabled: true,
            configT: 20,
            configJ: 10,
            multiplierProbabilities: [42, 28.8, 12.7, 10.8, 5.7],
            password: 'ma123456'
        };
    }

    readLegacyHighElasticEnabled() {
        return localStorage.getItem('hpb_high_elastic_enabled') !== 'false';
    }

    isValidAdminPassword(password) {
        return typeof password === 'string' && password.length > 0 && password.length <= 64;
    }

    loadGlobalConfig() {
        const defaults = this.getDefaultGlobalConfig();

        try {
            const saved = JSON.parse(localStorage.getItem(this.globalConfigStorageKey) || 'null');
            if (this.isValidGlobalConfig(saved)) return this.normalizeGlobalConfig(saved, defaults.password);

            // Migrate settings saved by earlier versions into the shared config.
            const oldProbabilities = JSON.parse(localStorage.getItem('hpb_multiplier_probabilities') || 'null');
            const migrated = {
                ...defaults,
                highElasticEnabled: this.readLegacyHighElasticEnabled(),
                configT: parseInt(localStorage.getItem('hpb_config_t') || defaults.configT, 10),
                configJ: parseInt(localStorage.getItem('hpb_config_j') || defaults.configJ, 10),
                multiplierProbabilities: Array.isArray(oldProbabilities)
                    ? oldProbabilities.map(Number) : defaults.multiplierProbabilities
            };
            return this.isValidGlobalConfig(migrated) ? this.normalizeGlobalConfig(migrated, defaults.password) : defaults;
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
        if (config.password !== undefined && !this.isValidAdminPassword(config.password)) {
            return false;
        }
        if (config.highElasticEnabled !== undefined && typeof config.highElasticEnabled !== 'boolean') {
            return false;
        }
        const probabilities = config.multiplierProbabilities.map(Number);
        const total = probabilities.reduce((sum, value) => sum + value, 0);
        return probabilities.every(value => Number.isFinite(value) && value >= 0) && Math.abs(total - 100) <= 0.01;
    }

    normalizeGlobalConfig(config, fallbackPassword = 'ma123456') {
        if (!this.isValidGlobalConfig(config)) return this.getDefaultGlobalConfig();
        return {
            soundEnabled: config.soundEnabled,
            highElasticEnabled: typeof config.highElasticEnabled === 'boolean'
                ? config.highElasticEnabled
                : this.readLegacyHighElasticEnabled(),
            configT: config.configT,
            configJ: config.configJ,
            multiplierProbabilities: config.multiplierProbabilities.map(Number),
            password: this.isValidAdminPassword(config.password) ? config.password : fallbackPassword
        };
    }

    applyGlobalConfig(config, notify = false) {
        if (!this.isValidGlobalConfig(config)) return false;
        const normalized = this.normalizeGlobalConfig(config, this.adminPassword || 'ma123456');
        this.configT = normalized.configT;
        this.configJ = normalized.configJ;
        this.multiplierProbabilities = normalized.multiplierProbabilities;
        this.adminPassword = normalized.password;
        if (window.soundEngine) window.soundEngine.enabled = normalized.soundEnabled;
        const highElasticChanged = this.highElasticEnabled !== normalized.highElasticEnabled;
        this.highElasticEnabled = normalized.highElasticEnabled;
        if (highElasticChanged && this.physics) this.applyHighElasticPins();

        if (notify) {
            this.populateGlobalSettingsFields();
            this.setStatus('全部机器配置已同步更新', true);
        }
        return true;
    }

    getGlobalConfig() {
        return {
            soundEnabled: !!(window.soundEngine && window.soundEngine.enabled),
            highElasticEnabled: !!this.highElasticEnabled,
            configT: this.configT,
            configJ: this.configJ,
            multiplierProbabilities: [...this.multiplierProbabilities],
            password: this.adminPassword || 'ma123456'
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

    // ==========================================
    // 账户系统：用户名登录，积分/弹珠跟随账户
    // ==========================================
    hasHttpOrigin() {
        return /^https?:$/.test(window.location.protocol);
    }

    isValidUsername(username) {
        return typeof username === 'string' && /^[\u4e00-\u9fffA-Za-z0-9_-]{1,20}$/.test(username);
    }

    normalizeUsername(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    isRoundBusy() {
        return this.feverActive ||
            this.autoInvestRunning ||
            this.gameState === 'BALL_IN_PLAY' ||
            this.gameState === 'RESOLVING' ||
            this.gameState === 'MULTIPLIER_ROLLING' ||
            this.gameState === 'CAT_SLOT';
    }

    requireLogin() {
        if (this.currentUsername) return true;
        if (this.accountLoading) {
            this.setStatus('正在登录账户…', true);
            return false;
        }
        this.openLoginModal(true);
        this.setStatus('请先输入用户名登录账户', true);
        return false;
    }

    getLocalAccounts() {
        try {
            const parsed = JSON.parse(localStorage.getItem(this.localAccountsStorageKey) || '{}');
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    writeLocalAccount(account) {
        if (!account || !account.username) return;
        const all = this.getLocalAccounts();
        all[account.username] = {
            username: account.username,
            totalBeads: account.totalBeads,
            totalScore: account.totalScore,
            updatedAt: account.updatedAt || Date.now()
        };
        localStorage.setItem(this.localAccountsStorageKey, JSON.stringify(all));
    }

    snapshotCurrentAccount() {
        return {
            username: this.currentUsername,
            totalBeads: this.totalBeads,
            totalScore: this.totalScore,
            updatedAt: this.accountUpdatedAt || Date.now()
        };
    }

    consumeLegacyMachineData() {
        if (localStorage.getItem(this.accountMigratedStorageKey)) {
            return { beads: 0, score: 0 };
        }
        const beads = parseInt(localStorage.getItem('hpb_total_beads_v3') || '0', 10) || 0;
        const score = parseInt(localStorage.getItem('hpb_total_score_v3') || '0', 10) || 0;
        localStorage.setItem(this.accountMigratedStorageKey, '1');
        return {
            beads: Number.isFinite(beads) && beads > 0 ? beads : 0,
            score: Number.isFinite(score) && score > 0 ? score : 0
        };
    }

    applyAccountData(account, { silent = false } = {}) {
        this.currentUsername = account.username;
        this.totalBeads = account.totalBeads;
        this.totalScore = account.totalScore;
        this.accountUpdatedAt = account.updatedAt || Date.now();
        this.accountDirty = false;
        localStorage.setItem(this.lastUsernameStorageKey, account.username);
        this.writeLocalAccount(account);
        this.updateAccountBar();
        this.updateHUD({ persist: false });
        if (!silent) {
            this.setStatus(`已进入账户「${account.username}」`, true);
        }
    }

    updateAccountBar() {
        if (this.accountNameLabelEl) {
            this.accountNameLabelEl.textContent = this.currentUsername || (this.accountLoading ? '登录中…' : '未登录');
        }
        if (this.accountSyncHintEl) {
            if (this.accountLoading) {
                this.accountSyncHintEl.textContent = '正在登录账户';
            } else if (!this.currentUsername) {
                this.accountSyncHintEl.textContent = '请先登录账户';
            } else if (this.usingServerAccounts) {
                this.accountSyncHintEl.textContent = '已同步到服务器';
            } else {
                this.accountSyncHintEl.textContent = '仅保存在本浏览器';
            }
        }
    }

    async apiJson(pathname, options = {}) {
        if (!this.hasHttpOrigin()) {
            const error = new Error('no-server');
            error.code = 'no-server';
            throw error;
        }
        const response = await fetch(pathname, {
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || `HTTP ${response.status}`);
            error.status = response.status;
            error.payload = data;
            throw error;
        }
        return data;
    }

    initAccountSystem() {
        this.updateAccountBar();
        window.addEventListener('pagehide', () => this.persistCurrentAccount(true));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.persistCurrentAccount(true);
        });
        if (this.accountPollTimer) clearInterval(this.accountPollTimer);
        this.accountPollTimer = setInterval(() => this.pullCurrentAccount(), 5000);

        const lastUsername = this.normalizeUsername(localStorage.getItem(this.lastUsernameStorageKey) || '');
        if (lastUsername && this.isValidUsername(lastUsername)) {
            this.accountLoading = true;
            this.updateAccountBar();
            this.loginWithUsername(lastUsername, { silent: true })
                .catch(() => this.openLoginModal(true))
                .finally(() => {
                    this.accountLoading = false;
                    this.updateAccountBar();
                });
            return;
        }
        this.openLoginModal(true);
    }

    openLoginModal(required = false) {
        const modal = document.getElementById('login-modal');
        const closeBtn = document.getElementById('login-modal-close');
        const title = document.getElementById('login-modal-title');
        const intro = document.getElementById('login-intro');
        const input = document.getElementById('login-username');
        const error = document.getElementById('login-error');
        const hint = document.getElementById('login-server-hint');
        if (!modal || !input) return;

        const switching = !required && !!this.currentUsername;
        if (title) title.textContent = switching ? '🐱 切换账户' : '🐱 登录账户';
        if (intro) {
            intro.textContent = switching
                ? '输入另一个用户名即可切换账户。当前账户的积分和弹珠会先保存。'
                : '输入用户名进入专属账户。积分和弹珠会保存在账户里，换浏览器也能继续玩。';
        }
        if (closeBtn) closeBtn.style.display = switching ? 'block' : 'none';
        if (error) error.style.display = 'none';
        input.value = this.currentUsername || this.normalizeUsername(localStorage.getItem(this.lastUsernameStorageKey) || '');
        if (hint) {
            hint.textContent = this.hasHttpOrigin()
                ? '用户名 1~20 个字，支持中文、字母、数字、下划线和短横线。'
                : '当前未使用共享服务，账户只保存在本浏览器。请用 node server.js 启动后即可跨浏览器同步。';
        }
        modal.dataset.required = required ? '1' : '0';
        modal.classList.add('active');
        setTimeout(() => input.focus(), 120);
    }

    async submitLogin() {
        const input = document.getElementById('login-username');
        const error = document.getElementById('login-error');
        const username = this.normalizeUsername(input ? input.value : '');
        if (!this.isValidUsername(username)) {
            if (error) {
                error.textContent = '用户名需为 1~20 个中文、字母、数字、下划线或短横线。';
                error.style.display = 'block';
            }
            return;
        }
        if (this.currentUsername === username) {
            this.closeModal('login-modal');
            return;
        }
        if (this.currentUsername && this.isRoundBusy()) {
            if (error) {
                error.textContent = '对局进行中，请先完成本局再切换账户。';
                error.style.display = 'block';
            }
            return;
        }
        try {
            await this.loginWithUsername(username);
            this.closeModal('login-modal');
        } catch (e) {
            if (error) {
                error.textContent = e.message || '登录失败，请重试。';
                error.style.display = 'block';
            }
        }
    }

    async loginWithUsername(rawUsername, { silent = false } = {}) {
        const username = this.normalizeUsername(rawUsername);
        if (!this.isValidUsername(username)) {
            throw new Error('用户名不合法');
        }

        if (this.currentUsername && this.currentUsername !== username) {
            this.refundPendingBet();
            await this.persistCurrentAccount(true);
        }

        let account = null;
        let created = false;
        try {
            const result = await this.apiJson('/api/accounts/login', {
                method: 'POST',
                body: JSON.stringify({ username })
            });
            account = result;
            created = !!result.created;
            this.usingServerAccounts = true;
        } catch (e) {
            this.usingServerAccounts = false;
            const local = this.getLocalAccounts()[username];
            if (local) {
                account = local;
            } else {
                account = {
                    username,
                    totalBeads: 0,
                    totalScore: 0,
                    updatedAt: Date.now()
                };
                created = true;
            }
        }

        const legacy = this.consumeLegacyMachineData();
        if ((created || (account.totalBeads === 0 && account.totalScore === 0)) && (legacy.beads || legacy.score)) {
            account.totalBeads += legacy.beads;
            account.totalScore += legacy.score;
            account.updatedAt = Date.now();
            await this.saveAccountRecord(account);
        }

        this.rewardBeads = 0;
        this.rewardScore = 0;
        this.currentBet = 0;
        this.currentMultiplier = 0;
        this.litSlots = [];
        this.physics.clearLitSlots();
        this.applyAccountData(account, { silent });
        this.loadAutoInvestSettings();
        this.updateAutoInvestButton();
        if (!this.isRoundBusy() && this.currentMultiplier === 0) {
            this.gameState = 'IDLE';
            this.scheduleAutoInvest();
        }
        return account;
    }

    refundPendingBet() {
        if (this.currentBet > 0) {
            this.totalBeads += this.currentBet;
            this.currentBet = 0;
        }
        this.collectTrayBeads();
    }

    persistCurrentAccount(immediate = false) {
        if (!this.currentUsername) return Promise.resolve(false);
        this.accountDirty = true;
        this.writeLocalAccount(this.snapshotCurrentAccount());
        if (immediate) {
            clearTimeout(this.accountSaveTimer);
            this.accountSaveTimer = null;
            if (this.accountSaving) return Promise.resolve(false);
            return this.flushAccountSave();
        }
        clearTimeout(this.accountSaveTimer);
        this.accountSaveTimer = setTimeout(() => this.flushAccountSave(), 400);
        return Promise.resolve(true);
    }

    async flushAccountSave() {
        if (!this.currentUsername || this.accountSaving) return false;
        this.accountSaving = true;
        try {
            do {
                this.accountDirty = false;
                const account = this.snapshotCurrentAccount();
                const saved = await this.saveAccountRecord(account);
                if (saved) {
                    this.accountUpdatedAt = saved.updatedAt || Date.now();
                    this.writeLocalAccount({ ...account, updatedAt: this.accountUpdatedAt });
                    this.updateAccountBar();
                }
            } while (this.accountDirty && this.currentUsername);
            return true;
        } finally {
            this.accountSaving = false;
        }
    }

    async saveAccountRecord(account) {
        this.writeLocalAccount(account);
        if (!this.hasHttpOrigin()) return account;
        try {
            const saved = await this.apiJson(`/api/accounts/${encodeURIComponent(account.username)}`, {
                method: 'PUT',
                body: JSON.stringify({
                    totalBeads: account.totalBeads,
                    totalScore: account.totalScore
                })
            });
            this.usingServerAccounts = true;
            return saved;
        } catch (e) {
            this.usingServerAccounts = false;
            this.updateAccountBar();
            return account;
        }
    }

    async pullCurrentAccount() {
        if (!this.currentUsername || !this.usingServerAccounts || this.accountDirty || this.accountSaving ||
            this.isRoundBusy() || this.currentBet > 0 || this.rewardBeads > 0) {
            return false;
        }
        try {
            const account = await this.apiJson(`/api/accounts/${encodeURIComponent(this.currentUsername)}`);
            if (!account || account.username !== this.currentUsername) return false;
            if (account.updatedAt && account.updatedAt > this.accountUpdatedAt &&
                (account.totalBeads !== this.totalBeads || account.totalScore !== this.totalScore)) {
                this.applyAccountData(account, { silent: true });
                this.setStatus(`账户「${account.username}」数据已从服务器更新`, true);
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    async fetchAccount(username) {
        const name = this.normalizeUsername(username);
        if (!this.isValidUsername(name)) throw new Error('用户名不合法');
        if (this.hasHttpOrigin()) {
            try {
                return await this.apiJson(`/api/accounts/${encodeURIComponent(name)}`);
            } catch (e) {
                if (e.status === 404) throw new Error('账户不存在');
                if (e.code !== 'no-server') throw e;
            }
        }
        const local = this.getLocalAccounts()[name];
        if (!local) throw new Error('账户不存在');
        return local;
    }

    async adminUpdateAccount(username, payload) {
        const name = this.normalizeUsername(username);
        if (!this.isValidUsername(name)) throw new Error('用户名不合法');

        if (this.hasHttpOrigin()) {
            try {
                const saved = await this.apiJson('/api/accounts/admin', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: name,
                        password: this.adminPassword,
                        ...payload
                    })
                });
                this.writeLocalAccount(saved);
                this.usingServerAccounts = true;
                return saved;
            } catch (e) {
                if (e.status === 403) throw new Error('管理密码错误');
                if (e.code !== 'no-server' && e.status !== 404) {
                    throw new Error(e.message || '保存失败');
                }
            }
        }

        const existing = this.getLocalAccounts()[name] || {
            username: name,
            totalBeads: 0,
            totalScore: 0,
            updatedAt: Date.now()
        };
        if (payload.totalBeads !== undefined) existing.totalBeads = payload.totalBeads;
        if (payload.totalScore !== undefined) existing.totalScore = payload.totalScore;
        if (payload.addBeads) existing.totalBeads = Math.max(0, existing.totalBeads + payload.addBeads);
        if (payload.addScore) existing.totalScore = Math.max(0, existing.totalScore + payload.addScore);
        existing.updatedAt = Date.now();
        this.writeLocalAccount(existing);
        return existing;
    }

    async lookupAdminAccount() {
        const input = document.getElementById('admin-account-username');
        const error = document.getElementById('admin-account-error');
        const editor = document.getElementById('admin-account-editor');
        const found = document.getElementById('admin-account-found');
        const beadsInput = document.getElementById('admin-account-beads');
        const scoreInput = document.getElementById('admin-account-score');
        const username = this.normalizeUsername(input ? input.value : '');
        if (error) error.style.display = 'none';
        if (!this.isValidUsername(username)) {
            if (editor) editor.style.display = 'none';
            if (error) {
                error.textContent = '请输入合法用户名后再查询。';
                error.style.display = 'block';
            }
            return;
        }
        try {
            const account = await this.fetchAccount(username);
            if (editor) editor.style.display = 'block';
            if (found) found.textContent = `已找到账户「${account.username}」`;
            if (beadsInput) beadsInput.value = account.totalBeads;
            if (scoreInput) scoreInput.value = account.totalScore;
            window.soundEngine.playBtnClick();
        } catch (e) {
            if (editor) editor.style.display = 'none';
            if (error) {
                error.textContent = e.message === '账户不存在'
                    ? '账户不存在。可在【加珠】里输入该用户名充入弹珠来创建账户。'
                    : (e.message || '查询失败');
                error.style.display = 'block';
            }
        }
    }

    adjustAdminAccountField(field, delta) {
        const input = document.getElementById(field === 'score' ? 'admin-account-score' : 'admin-account-beads');
        if (!input) return;
        const current = parseInt(input.value, 10) || 0;
        input.value = Math.max(0, current + delta);
        window.soundEngine.playBtnClick();
    }

    async saveAdminAccount() {
        const nameInput = document.getElementById('admin-account-username');
        const beadsInput = document.getElementById('admin-account-beads');
        const scoreInput = document.getElementById('admin-account-score');
        const error = document.getElementById('admin-account-error');
        const found = document.getElementById('admin-account-found');
        const username = this.normalizeUsername(nameInput ? nameInput.value : '');
        const nextBeads = beadsInput ? parseInt(beadsInput.value, 10) : NaN;
        const nextScore = scoreInput ? parseInt(scoreInput.value, 10) : NaN;
        if (error) error.style.display = 'none';
        if (!this.isValidUsername(username) || !Number.isInteger(nextBeads) || nextBeads < 0 ||
            !Number.isInteger(nextScore) || nextScore < 0) {
            if (error) {
                error.textContent = '请先查询账户，并填写大于等于 0 的整数。';
                error.style.display = 'block';
            }
            return;
        }
        try {
            const saved = await this.adminUpdateAccount(username, {
                totalBeads: nextBeads,
                totalScore: nextScore
            });
            if (found) found.textContent = `已保存账户「${saved.username}」：弹珠 ${saved.totalBeads}，积分 ${saved.totalScore}`;
            if (this.currentUsername === saved.username) {
                this.applyAccountData(saved, { silent: true });
            }
            window.soundEngine.playSlotWin(1);
            this.setStatus(`已更新账户「${saved.username}」的积分和弹珠`, true);
        } catch (e) {
            if (error) {
                error.textContent = e.message || '保存失败';
                error.style.display = 'block';
            }
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
        if (!this.requireLogin()) return false;
        if (this.autoInvestRunning) return false;
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
        if (!this.requireLogin()) return;
        if (this.autoInvestRunning) return;

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
            this.clearStartReady();
            this.cancelAutoInvestInsert(true);
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

    // 从落点中随机选取 count 个互不相邻的灯格（任意两个中奖灯之间至少隔 1 格）
    pickNonAdjacentSlotIndices(count) {
        const total = this.physics.slots.length;
        // 一排 n 个孔洞最多可点亮 ceil(n / 2) 个互不相邻的灯
        const maxIndependent = Math.ceil(total / 2);
        const k = Math.min(Math.max(0, count | 0), maxIndependent, total);
        if (k <= 0) return [];

        // 从 n-k+1 个数中均匀抽 k 个，再映射为间隔至少为 2 的下标
        const poolSize = total - k + 1;
        const pool = Array.from({ length: poolSize }, (_, i) => i);
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool
            .slice(0, k)
            .sort((a, b) => a - b)
            .map((value, offset) => value + offset);
    }

    // 锁定倍率并点亮落点中的随机灯格（中奖灯不得相邻）
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

        this.litSlots = this.pickNonAdjacentSlotIndices(litCount);

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
        if (this.shouldAutoLaunch()) this.scheduleAutoLaunch();
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
        const slot = this.coinSlot;
        if (!slot) return;
        // Avoid forced reflow (offsetWidth) and CSS filter — both flash the
        // playfield canvas on mobile as if the pins were being rebuilt.
        if (slot.classList.contains('coin-slot-active')) return;
        const onEnd = () => {
            slot.classList.remove('coin-slot-active');
            slot.removeEventListener('animationend', onEnd);
        };
        slot.addEventListener('animationend', onEnd);
        slot.classList.add('coin-slot-active');
    }

    clampAutoInvestAmount(value) {
        const amount = parseInt(value, 10);
        if (!Number.isInteger(amount)) return 10;
        return Math.min(99, Math.max(5, amount));
    }

    readAutoInvestStore() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.autoInvestStorageKey) || 'null');
            return saved && typeof saved === 'object' ? saved : {};
        } catch (e) {
            return {};
        }
    }

    loadAutoInvestSettings() {
        const store = this.readAutoInvestStore();
        const data = (this.currentUsername && store[this.currentUsername]) || store._ || store;
        const enabled = !!(data && data.enabled);
        const autoStart = !!(data && data.autoStart);
        const amount = this.clampAutoInvestAmount(data && data.amount);
        this.autoInvestEnabled = enabled;
        this.autoStartEnabled = autoStart;
        this.autoInvestAmount = amount;
        this.autoInvestPaused = false;
    }

    saveAutoInvestSettings() {
        const store = this.readAutoInvestStore();
        const payload = {
            enabled: this.autoInvestEnabled,
            amount: this.autoInvestAmount,
            autoStart: this.autoStartEnabled
        };
        store._ = payload;
        if (this.currentUsername) store[this.currentUsername] = payload;
        localStorage.setItem(this.autoInvestStorageKey, JSON.stringify(store));
    }

    updateAutoInvestButton() {
        const btn = document.getElementById('btn-auto-invest');
        const label = document.getElementById('auto-invest-label');
        if (!btn || !label) return;
        btn.classList.toggle('is-on', this.autoInvestEnabled);
        btn.classList.toggle('is-running', this.autoInvestRunning);
        btn.classList.toggle('is-paused', this.autoInvestEnabled && this.autoInvestPaused);
        if (!this.autoInvestEnabled) {
            label.textContent = '定投';
            btn.title = '定投模式：设定每局自动投入珠数';
        } else if (this.autoInvestRunning) {
            label.textContent = `定投中(${this.autoInvestAmount})`;
            btn.title = `正在定投 ${this.autoInvestAmount} 颗`;
        } else {
            label.textContent = `定投: ${this.autoInvestAmount}`;
            btn.title = this.autoInvestPaused
                ? `定投已暂停（珠子不足 ${this.autoInvestAmount} 颗）`
                : `定投每局 ${this.autoInvestAmount} 颗${this.autoStartEnabled ? '，自动开局' : ''}`;
        }
    }

    highlightStartBtn() {
        const btn = document.getElementById('btn-start-game');
        if (!btn) return;
        btn.classList.add('start-ready');
    }

    clearStartReady() {
        const btn = document.getElementById('btn-start-game');
        if (btn) btn.classList.remove('start-ready');
    }

    canRunAutoInvest() {
        return this.autoInvestEnabled &&
            !this.autoInvestRunning &&
            !this.isFreeLaunch &&
            !this.feverActive &&
            !this.pendingFever &&
            !this.pendingCatSlot &&
            this.currentMultiplier === 0 &&
            this.gameState === 'IDLE';
    }

    shouldAutoLaunch() {
        return this.autoInvestEnabled &&
            this.autoStartEnabled &&
            !this.isFreeLaunch &&
            !this.feverActive &&
            this.gameState === 'READY_TO_LAUNCH';
    }

    cancelAutoInvestInsert(finalize = true) {
        if (this.autoInvestTimer) {
            clearTimeout(this.autoInvestTimer);
            this.autoInvestTimer = null;
        }
        if (this.autoInvestAnimFrame) {
            cancelAnimationFrame(this.autoInvestAnimFrame);
            this.autoInvestAnimFrame = null;
        }
        if (this.autoInvestRunning && finalize) {
            this.finishAutoInvestInsert(this.autoInvestAmount, { startGame: false });
            return;
        }
        this.autoInvestRunning = false;
        this.autoInvestAnimValue = null;
        if (this.loadedCountEl) this.loadedCountEl.classList.remove('is-rolling');
        this.updateAutoInvestButton();
    }

    cancelAutoLaunch() {
        if (this.autoLaunchTimer) {
            clearTimeout(this.autoLaunchTimer);
            this.autoLaunchTimer = null;
        }
        if (this.autoLaunchFrame) {
            cancelAnimationFrame(this.autoLaunchFrame);
            this.autoLaunchFrame = null;
        }
    }

    cancelAutoPlay() {
        this.cancelAutoInvestInsert(true);
        this.cancelAutoLaunch();
        this.clearStartReady();
    }

    scheduleAutoInvest(delayMs = this.autoInvestSettleDelayMs) {
        this.cancelAutoInvestInsert(true);
        if (!this.canRunAutoInvest()) return;
        this.autoInvestTimer = setTimeout(() => {
            this.autoInvestTimer = null;
            this.runAutoInvest();
        }, Math.max(0, delayMs));
    }

    runAutoInvest() {
        if (!this.canRunAutoInvest()) return;
        if (!this.requireLogin()) return;
        if (document.querySelector('.modal.active')) {
            this.scheduleAutoInvest();
            return;
        }

        const target = this.autoInvestAmount;
        if (this.currentBet >= target) {
            this.autoInvestPaused = false;
            this.updateAutoInvestButton();
            this.onAutoInvestSettled();
            return;
        }

        const need = target - this.currentBet;
        if (this.totalBeads < need) {
            this.autoInvestPaused = true;
            this.updateAutoInvestButton();
            this.setStatus(`⚠️ 珠子不足 ${target} 颗，定投已暂停。补充珠子后将自动继续。`, true);
            this.highlightAddBeadsBtn();
            return;
        }

        this.autoInvestPaused = false;
        this.autoInvestRunning = true;
        this.totalBeads -= need;
        const fromValue = this.currentBet;
        this.updateHUD();
        this.updateAutoInvestButton();
        this.setStatus(`定投灌入 ${target} 颗…`);
        window.soundEngine.playAutoInvestBurst();
        this.playInsertEffect();
        this.animateAutoInvestCount(fromValue, target);
    }

    animateAutoInvestCount(fromValue, target) {
        if (this.loadedCountEl) this.loadedCountEl.classList.add('is-rolling');
        const duration = this.autoInvestRollMs;
        const start = performance.now();
        const tick = (now) => {
            if (!this.autoInvestRunning) return;
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            this.autoInvestAnimValue = Math.round(fromValue + (target - fromValue) * eased);
            if (this.loadedCountEl) this.loadedCountEl.textContent = `${this.autoInvestAnimValue}`;
            if (t < 1) {
                this.autoInvestAnimFrame = requestAnimationFrame(tick);
                return;
            }
            this.autoInvestAnimFrame = null;
            this.finishAutoInvestInsert(target, { startGame: true });
        };
        this.autoInvestAnimFrame = requestAnimationFrame(tick);
    }

    finishAutoInvestInsert(target, { startGame = true } = {}) {
        this.autoInvestRunning = false;
        this.autoInvestAnimValue = null;
        this.currentBet = target;
        if (this.loadedCountEl) this.loadedCountEl.classList.remove('is-rolling');
        this.updateHUD();
        this.updateAutoInvestButton();
        if (!startGame || this.gameState !== 'IDLE' || this.currentMultiplier !== 0) return;
        this.onAutoInvestSettled();
    }

    onAutoInvestSettled() {
        if (this.currentBet < 5) return;
        this.highlightStartBtn();
        this.setStatus(`定投已投入 ${this.currentBet} 颗，点击【开始】抽取倍率`);
        if (this.autoStartEnabled) this.onStartBtnClicked();
    }

    scheduleAutoLaunch() {
        this.cancelAutoLaunch();
        if (!this.shouldAutoLaunch()) return;
        this.autoLaunchTimer = setTimeout(() => {
            this.autoLaunchTimer = null;
            this.runAutoLaunch();
        }, this.autoLaunchAfterLockMs);
    }

    runAutoLaunch() {
        if (!this.shouldAutoLaunch() || this.isPullingPlunger) return;
        if (document.querySelector('.modal.active')) return;
        this.ensureBallStaged();
        const knob = this.plungerKnob;
        const duration = this.autoLaunchPullMs;
        const start = performance.now();
        const pull = (now) => {
            if (!this.shouldAutoLaunch() || this.isPullingPlunger) return;
            const t = Math.min(1, (now - start) / duration);
            const dist = 60 * t;
            this.physics.setPlungerPull(dist);
            if (knob) knob.style.transform = `translateY(${dist}px)`;
            if (this.plungerSpringVisual) {
                this.plungerSpringVisual.style.transform = `scaleY(${1 - (dist / 60) * 0.45})`;
            }
            if (t < 1) {
                this.autoLaunchFrame = requestAnimationFrame(pull);
                return;
            }
            this.autoLaunchFrame = null;
            window.soundEngine.playSpringPull(1);
            this.physics.releasePlunger();
            if (knob) knob.style.transform = 'translateY(0px)';
            if (this.plungerSpringVisual) this.plungerSpringVisual.style.transform = 'scaleY(1)';
        };
        this.autoLaunchFrame = requestAnimationFrame(pull);
    }

    selectAutoInvestChip(chip) {
        window.soundEngine.playBtnClick();
        document.querySelectorAll('.auto-invest-chip').forEach((el) => el.classList.remove('selected'));
        chip.classList.add('selected');
        const amount = parseInt(chip.dataset.amount, 10);
        const custom = document.getElementById('auto-invest-custom-amount');
        if (!custom) return;
        if (amount > 0) custom.value = String(amount);
        else custom.value = '';
    }

    onAutoInvestCustomInput() {
        const custom = document.getElementById('auto-invest-custom-amount');
        const amount = parseInt(custom && custom.value, 10);
        document.querySelectorAll('.auto-invest-chip').forEach((el) => {
            const chipAmount = parseInt(el.dataset.amount, 10);
            el.classList.toggle('selected', Number.isInteger(amount) && amount === chipAmount);
        });
    }

    syncAutoInvestModal() {
        const custom = document.getElementById('auto-invest-custom-amount');
        const autoStart = document.getElementById('toggle-auto-start');
        if (custom) custom.value = this.autoInvestEnabled ? String(this.autoInvestAmount) : '';
        if (autoStart) autoStart.checked = this.autoStartEnabled;
        document.querySelectorAll('.auto-invest-chip').forEach((el) => {
            const chipAmount = parseInt(el.dataset.amount, 10);
            const selected = this.autoInvestEnabled
                ? chipAmount === this.autoInvestAmount
                : chipAmount === 0;
            el.classList.toggle('selected', selected);
        });
        if (this.autoInvestEnabled && ![5, 10, 20, 50].includes(this.autoInvestAmount)) {
            document.querySelectorAll('.auto-invest-chip').forEach((el) => el.classList.remove('selected'));
        }
    }

    openAutoInvestModal() {
        window.soundEngine.playBtnClick();
        this.syncAutoInvestModal();
        const modal = document.getElementById('auto-invest-modal');
        if (modal) modal.classList.add('active');
    }

    confirmAutoInvest() {
        const custom = document.getElementById('auto-invest-custom-amount');
        const autoStart = document.getElementById('toggle-auto-start');
        const offChip = document.querySelector('.auto-invest-chip.is-off.selected');
        const selectedChip = document.querySelector('.auto-invest-chip.selected:not(.is-off)');
        const typed = parseInt(custom && custom.value, 10);

        let enabled = this.autoInvestEnabled;
        let amount = this.autoInvestAmount;
        if (offChip) {
            enabled = false;
        } else if (selectedChip) {
            enabled = true;
            amount = this.clampAutoInvestAmount(selectedChip.dataset.amount);
        } else if (Number.isInteger(typed) && typed >= 5 && typed <= 99) {
            enabled = true;
            amount = typed;
        } else if (enabled) {
            amount = this.clampAutoInvestAmount(amount);
        } else {
            this.setStatus('请选择 5 / 10 / 20 / 50，或输入 5~99 颗', true);
            return;
        }

        this.autoInvestEnabled = enabled;
        this.autoInvestAmount = amount;
        this.autoStartEnabled = !!(autoStart && autoStart.checked);
        this.autoInvestPaused = false;
        this.saveAutoInvestSettings();
        this.updateAutoInvestButton();
        this.closeModal('auto-invest-modal');

        if (!enabled) {
            this.cancelAutoPlay();
            this.setStatus('定投已关闭');
            return;
        }

        const startHint = this.autoStartEnabled ? '，自动开局已开启' : '';
        this.setStatus(`定投已设为每局 ${amount} 颗${startHint}`, true);
        if (this.gameState === 'READY_TO_LAUNCH' && this.autoStartEnabled) {
            this.scheduleAutoLaunch();
            return;
        }
        this.scheduleAutoInvest(0);
    }

    // 事件绑定
    initEventListeners() {
        const btnInsert = document.getElementById('btn-insert-ball');
        if (btnInsert) {
            // 点击 +1 且支持一直按住连续快速投珠
            const startHold = (e) => {
                e.preventDefault();
                this.insertSingleBall();
                if (typeof btnInsert.blur === 'function') btnInsert.blur();
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

            const endHold = (e) => {
                if (e) e.preventDefault();
                clearTimeout(this.insertHoldTimer);
                clearInterval(this.insertHoldInterval);
                if (typeof btnInsert.blur === 'function') btnInsert.blur();
            };

            btnInsert.addEventListener('mousedown', startHold);
            btnInsert.addEventListener('mouseup', endHold);
            btnInsert.addEventListener('mouseleave', endHold);
            btnInsert.addEventListener('click', (e) => e.preventDefault());

            btnInsert.addEventListener('touchstart', startHold, { passive: false });
            btnInsert.addEventListener('touchend', endHold, { passive: false });
            btnInsert.addEventListener('touchcancel', endHold, { passive: false });
        }

        document.querySelectorAll('.bet-quick-btn').forEach((button) => {
            let lastTouchAt = 0;
            const insertQuick = () => {
                const count = parseInt(button.dataset.insertCount, 10);
                this.insertBalls(count);
                if (typeof button.blur === 'function') button.blur();
            };
            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                lastTouchAt = performance.now();
                insertQuick();
            }, { passive: false });
            button.addEventListener('click', (e) => {
                if (performance.now() - lastTouchAt < 500) {
                    e.preventDefault();
                    return;
                }
                insertQuick();
            });
        });

        const btnStart = document.getElementById('btn-start-game');
        if (btnStart) {
            btnStart.addEventListener('click', () => this.onStartBtnClicked());
        }

        const btnAutoInvest = document.getElementById('btn-auto-invest');
        if (btnAutoInvest) {
            btnAutoInvest.addEventListener('click', () => this.openAutoInvestModal());
        }
        document.querySelectorAll('.auto-invest-chip').forEach((chip) => {
            chip.addEventListener('click', () => this.selectAutoInvestChip(chip));
        });
        const customAmount = document.getElementById('auto-invest-custom-amount');
        if (customAmount) {
            customAmount.addEventListener('input', () => this.onAutoInvestCustomInput());
            customAmount.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.confirmAutoInvest();
            });
        }

        // 免费加珠 (管理密码来自全部机器配置)
        const btnFree = document.getElementById('btn-free-beads');
        if (btnFree) {
            btnFree.addEventListener('click', () => this.openAddBeadsModal());
        }

        const btnShake = document.getElementById('btn-shake-machine');
        if (btnShake) btnShake.addEventListener('click', () => this.shakeMachine());

        const btnSetting = document.getElementById('btn-settings');
        if (btnSetting) btnSetting.addEventListener('click', () => this.openSettingsPasswordModal());

        const btnAccount = document.getElementById('btn-account');
        if (btnAccount) {
            btnAccount.addEventListener('click', () => {
                window.soundEngine.playBtnClick();
                this.openLoginModal(!this.currentUsername);
            });
        }

        const btnBackpack = document.getElementById('btn-backpack');
        if (btnBackpack) btnBackpack.addEventListener('click', () => this.openBackpackModal());

        const slotLever = document.getElementById('cat-slot-lever');
        if (slotLever) {
            slotLever.addEventListener('click', () => this.spinCatSlot());
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
            this.cancelAutoLaunch();
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
                this.cancelAutoLaunch();
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
        this.cancelAutoLaunch();
        this.clearStartReady();
        this.collectTrayBeads();
        this.currentBet = 0;
        this.currentMultiplier = 0;
        this.litSlots = [];
        this.isFreeLaunch = false;
        this.feverRoundGain = 0;
        this.physics.clearLitSlots();
        this.updateHUD();

        // 当局已结算：进度条满了就在此时开启 Fever，不打断上一局
        if (this.pendingFever) {
            this.gameState = 'IDLE';
            this.startFever();
            return;
        }

        if (this.pendingCatSlot) {
            this.pendingCatSlot = false;
            this.startCatSlot();
            return;
        }

        this.gameState = 'IDLE';
        this.setStatus('等待开始 (请投入 5~99 颗弹珠开局)');
        this.scheduleAutoInvest();
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
        this.cancelAutoPlay();
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
        this.scheduleAutoInvest();
    }

    grantFreeLaunch(mult) {
        this.cancelAutoPlay();
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
        if (this.feverEnergy >= 100) this.requestFever();
    }

    shouldDeferFeverStart() {
        return this.feverActive ||
            this.gameState === 'BALL_IN_PLAY' ||
            this.gameState === 'RESOLVING' ||
            this.gameState === 'MULTIPLIER_ROLLING' ||
            this.gameState === 'READY_TO_LAUNCH' ||
            this.gameState === 'CAT_SLOT';
    }

    requestFever() {
        if (this.feverActive || this.feverEnergy < 100) return;
        if (this.shouldDeferFeverStart()) {
            if (!this.pendingFever) {
                this.pendingFever = true;
                this.setStatus('🔥 Fever 已蓄满！当局结算后开启狂欢！', true);
            }
            return;
        }
        this.startFever();
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
        this.cancelAutoPlay();
        this.pendingFever = false;
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

        const feverLit = this.pickNonAdjacentSlotIndices(this.feverLitCount);
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

        if (this.pendingRoundReset || this.pendingCatSlot) {
            this.pendingRoundReset = false;
            setTimeout(() => this.resetRound(), 900);
        } else {
            this.updateHUD();
            this.scheduleAutoInvest();
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
    // 免费加珠模块 (管理密码来自全部机器配置)
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
        const usernameInput = document.getElementById('add-beads-username');
        if (usernameInput) usernameInput.value = this.currentUsername || '';
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

        if (pwdInput.value === this.adminPassword) {
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

    async confirmAddBeads() {
        const amountInput = document.getElementById('add-beads-amount');
        const usernameInput = document.getElementById('add-beads-username');
        const addNum = parseInt(amountInput.value, 10);
        const targetUsername = this.normalizeUsername(usernameInput ? usernameInput.value : this.currentUsername);

        if (isNaN(addNum) || addNum <= 0) {
            alert('请输入大于 0 的有效珠子数量！');
            return;
        }
        if (!this.isValidUsername(targetUsername)) {
            alert('请输入合法的目标用户名。');
            return;
        }

        try {
            if (this.currentUsername === targetUsername) {
                await this.persistCurrentAccount(true);
            }
            const saved = await this.adminUpdateAccount(targetUsername, { addBeads: addNum });
            if (this.currentUsername === saved.username) {
                this.applyAccountData(saved, { silent: true });
            }
            window.soundEngine.playSlotWin(1);
            this.closeModal('add-beads-modal');
            this.setStatus(`✅ 已向账户「${saved.username}」添加 ${addNum} 颗弹珠，当前 ${saved.totalBeads} 颗`, true);
            if (this.currentUsername === saved.username && this.autoInvestEnabled) {
                this.autoInvestPaused = false;
                this.updateAutoInvestButton();
                this.scheduleAutoInvest();
            }
        } catch (e) {
            alert(e.message || '加珠失败，请重试。');
        }
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
        const myRankItem = document.querySelector('#rank-modal .my-rank span');
        if (myRankItem && myRankItem !== myScoreEl) {
            myRankItem.textContent = this.currentUsername
                ? `⭐ 4. ${this.currentUsername} (当前总积分)`
                : '⭐ 4. 我 (当前总积分)';
        }
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
        if (input && input.value === this.adminPassword) {
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
        const highElasticToggle = document.getElementById('toggle-high-elastic');
        const inputT = document.getElementById('config-param-t');
        const inputJ = document.getElementById('config-param-j');
        const probabilityInputs = [2, 4, 6, 8, 10].map(m => document.getElementById(`prob-mult-${m}`));

        if (soundToggle) soundToggle.checked = window.soundEngine.enabled;
        if (highElasticToggle) highElasticToggle.checked = !!this.highElasticEnabled;
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
        const currentHint = document.getElementById('settings-current-account-hint');
        if (currentHint) {
            currentHint.textContent = this.currentUsername
                ? `仅更新账户「${this.currentUsername}」`
                : '请先登录账户';
        }
        const adminName = document.getElementById('admin-account-username');
        const adminError = document.getElementById('admin-account-error');
        const adminEditor = document.getElementById('admin-account-editor');
        if (adminName && !adminName.value && this.currentUsername) adminName.value = this.currentUsername;
        if (adminError) adminError.style.display = 'none';
        if (adminEditor) adminEditor.style.display = 'none';
        const newPasswordInput = document.getElementById('config-new-password');
        const confirmPasswordInput = document.getElementById('config-confirm-password');
        if (newPasswordInput) newPasswordInput.value = '';
        if (confirmPasswordInput) confirmPasswordInput.value = '';

        modal.classList.add('active');
    }

    async saveSettings() {
        const inputT = document.getElementById('config-param-t');
        const inputJ = document.getElementById('config-param-j');
        const soundToggle = document.getElementById('toggle-sound');
        const highElasticToggle = document.getElementById('toggle-high-elastic');
        const inputBeads = document.getElementById('config-total-beads');
        const inputScore = document.getElementById('config-total-score');
        const newPasswordInput = document.getElementById('config-new-password');
        const confirmPasswordInput = document.getElementById('config-confirm-password');
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

        const nextPassword = newPasswordInput ? newPasswordInput.value : '';
        const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';
        if (nextPassword || confirmPassword) {
            if (nextPassword !== confirmPassword) {
                alert('两次输入的管理密码不一致。');
                return;
            }
            if (!this.isValidAdminPassword(nextPassword)) {
                alert('管理密码不能为空，且不超过 64 个字符。');
                return;
            }
        }

        this.configT = nextT;
        this.configJ = nextJ;
        if (this.currentUsername) {
            this.totalBeads = nextBeads;
            this.totalScore = nextScore;
        }
        this.multiplierProbabilities = nextProbabilities;
        if (nextPassword) this.adminPassword = nextPassword;
        window.soundEngine.enabled = soundToggle ? soundToggle.checked : window.soundEngine.enabled;
        const nextHighElastic = highElasticToggle ? highElasticToggle.checked : this.highElasticEnabled;
        const highElasticChanged = this.highElasticEnabled !== !!nextHighElastic;
        this.highElasticEnabled = !!nextHighElastic;
        if (highElasticChanged) this.applyHighElasticPins();
        localStorage.setItem('hpb_high_elastic_enabled', this.highElasticEnabled ? 'true' : 'false');
        const syncedToServer = await this.saveGlobalConfig(this.getGlobalConfig());

        this.updateHUD();
        await this.persistCurrentAccount(true);
        this.closeModal('setting-modal');
        const syncMessage = syncedToServer
            ? '全部机器配置已同步'
            : '配置已保存；使用共享服务启动后可同步到不同机器';
        const passwordMessage = nextPassword ? '；管理密码已更新' : '';
        const accountMessage = this.currentUsername
            ? `；账户「${this.currentUsername}」的弹珠和积分已保存`
            : '；请先登录账户后再保存弹珠和积分';
        this.setStatus(`${syncMessage} (T=${this.configT}, J=${this.configJ})${passwordMessage}${accountMessage}`, true);
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
        if (id === 'login-modal' && !this.currentUsername) return;
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

    async resetData() {
        if (!this.currentUsername) {
            alert('请先登录账户。');
            return;
        }
        if (confirm(`确定要将账户「${this.currentUsername}」的弹珠和积分重置为 0 吗？全局配置不会受影响。`)) {
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
            this.pendingFever = false;
            this.feverEnergy = 0;
            this.feverRoundGain = 0;
            localStorage.setItem('hpb_fever_energy', '0');
            this.updateFeverUI();
            this.slotWinCount = 0;
            this.pendingCatSlot = false;
            this.isFreeLaunch = false;
            localStorage.setItem('hpb_slot_win_count', '0');
            this.gameState = 'IDLE';
            this.closeCatSlot();
            this.updateSlotProgressUI();
            this.cancelAutoPlay();
            this.updateHUD();
            await this.persistCurrentAccount(true);
            this.closeModal('setting-modal');
            this.setStatus(`账户「${this.currentUsername}」的弹珠和积分已重置为 0`);
            this.scheduleAutoInvest();
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
