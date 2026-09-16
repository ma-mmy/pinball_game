/**
 * AudioEngine - Web Audio API Procedural Sound Synthesizer V3.0
 * 纯原生 Web Audio API 合成音效，零外部资源依赖，100% 离线可用
 */
class SoundEngine {
    constructor() {
        this.ctx = null;
        this.enabled = true;
        this.feverBoost = false;
        this.initOnInteraction = this.initOnInteraction.bind(this);
        window.addEventListener('click', this.initOnInteraction, { once: true });
        window.addEventListener('touchstart', this.initOnInteraction, { once: true });
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    initOnInteraction() {
        this.init();
    }

    // 细金属钉碰撞声 (五音阶叮咚谐波)
    playPinHit(pitchFactor = 1.0) {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        const baseFreqs = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
        const baseFreq = baseFreqs[Math.floor(Math.random() * baseFreqs.length)];
        osc.frequency.setValueAtTime(baseFreq * (0.9 + pitchFactor * 0.2), now);

        const overtone = this.ctx.createOscillator();
        const overGain = this.ctx.createGain();
        overtone.type = 'triangle';
        overtone.frequency.setValueAtTime(baseFreq * 2.76, now);

        const volumeScale = this.feverBoost ? 1.45 : 1;
        gain.gain.setValueAtTime(0.18 * volumeScale, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

        overGain.gain.setValueAtTime(0.08 * volumeScale, now);
        overGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

        osc.connect(gain);
        overtone.connect(overGain);
        gain.connect(this.ctx.destination);
        overGain.connect(this.ctx.destination);

        osc.start(now);
        overtone.start(now);
        osc.stop(now + 0.2);
        overtone.stop(now + 0.1);
    }

    // 左上方阻挡立柱与高弹胶垫碰撞重音
    playPillarHit(isLeftBlocker = false) {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        const startFreq = isLeftBlocker ? 620 : 500;
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.16);

        gain.gain.setValueAtTime(0.32, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

        const snap = this.ctx.createOscillator();
        const snapGain = this.ctx.createGain();
        snap.type = 'triangle';
        snap.frequency.setValueAtTime(isLeftBlocker ? 1280 : 960, now);
        snapGain.gain.setValueAtTime(0.15, now);
        snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(gain);
        snap.connect(snapGain);
        gain.connect(this.ctx.destination);
        snapGain.connect(this.ctx.destination);

        osc.start(now);
        snap.start(now);
        osc.stop(now + 0.2);
        snap.stop(now + 0.08);
    }

    // 投珠音效 (连点/长按极速投珠时清脆短促)
    playInsertBead() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800 + Math.random() * 150, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.045);
    }

    // 定投一次性入币：短促机械仓门 + 集中三连撞击，避免连响 N 次
    playAutoInvestBurst() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;

        const thump = this.ctx.createOscillator();
        const thumpGain = this.ctx.createGain();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(240, now);
        thump.frequency.exponentialRampToValueAtTime(88, now + 0.09);
        thumpGain.gain.setValueAtTime(0.24, now);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        thump.connect(thumpGain);
        thumpGain.connect(this.ctx.destination);
        thump.start(now);
        thump.stop(now + 0.14);

        [0, 0.028, 0.056].forEach((offset, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1020 - i * 110, now + offset);
            osc.frequency.exponentialRampToValueAtTime(430 - i * 36, now + offset + 0.07);
            gain.gain.setValueAtTime(0.17, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.09);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.1);
        });
    }

    // 弹簧拉杆蓄力齿轮声 (Ratchet Click)
    playSpringPull(stretch) {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(160 + stretch * 240, now);

        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
    }

    // 弹簧释放击发声
    playSpringRelease(power) {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;

        const thump = this.ctx.createOscillator();
        const thumpGain = this.ctx.createGain();
        thump.type = 'sine';
        thump.frequency.setValueAtTime(140 + power * 80, now);
        thump.frequency.exponentialRampToValueAtTime(30, now + 0.16);

        thumpGain.gain.setValueAtTime(0.38, now);
        thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

        const twang = this.ctx.createOscillator();
        const twangGain = this.ctx.createGain();
        twang.type = 'triangle';
        twang.frequency.setValueAtTime(340, now);
        twang.frequency.linearRampToValueAtTime(180, now + 0.22);

        twangGain.gain.setValueAtTime(0.14, now);
        twangGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        thump.connect(thumpGain);
        twang.connect(twangGain);
        thumpGain.connect(this.ctx.destination);
        twangGain.connect(this.ctx.destination);

        thump.start(now);
        twang.start(now);
        thump.stop(now + 0.18);
        twang.stop(now + 0.25);
    }

    // 倍率滚动轮播音效 (Roulette Tick)
    playMultiplierTick() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(950, now);
        osc.frequency.exponentialRampToValueAtTime(450, now + 0.03);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
    }

    // 倍率确定锁定音效 (Lock Ding)
    playMultiplierLocked(mult) {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const notes = [587.33, 783.99, 1174.66];
        notes.forEach((f, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, now + idx * 0.06);
            gain.gain.setValueAtTime(0.2, now + idx * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.25);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.06);
            osc.stop(now + idx * 0.06 + 0.3);
        });
    }

    // 中奖胜利音效 (亮灯中奖 + 爆奖)
    playSlotWin(multiplier = 1) {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];

        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.07);

            gain.gain.setValueAtTime(0.18, now + idx * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.25);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now + idx * 0.07);
            osc.stop(now + idx * 0.07 + 0.28);
        });
    }

    // 未中奖 (未亮灯格，低沉全损叹气音)
    playLossSound() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.35);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
    }

    // 奖励珠子滚落到托盘声
    playBallDrop() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const count = 3;
        for (let i = 0; i < count; i++) {
            const t = now + i * 0.04 + Math.random() * 0.02;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(450 + Math.random() * 300, t);
            gain.gain.setValueAtTime(0.08, t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(t);
            osc.stop(t + 0.06);
        }
    }

    playBtnClick() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
    }

    playFeverStart() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const fanfare = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
        fanfare.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = idx % 2 === 0 ? 'triangle' : 'square';
            osc.frequency.setValueAtTime(freq, now + idx * 0.055);
            gain.gain.setValueAtTime(0.22, now + idx * 0.055);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.32);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.055);
            osc.stop(now + idx * 0.055 + 0.36);
        });

        const boom = this.ctx.createOscillator();
        const boomGain = this.ctx.createGain();
        boom.type = 'sine';
        boom.frequency.setValueAtTime(90, now);
        boom.frequency.exponentialRampToValueAtTime(28, now + 0.4);
        boomGain.gain.setValueAtTime(0.4, now);
        boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        boom.connect(boomGain);
        boomGain.connect(this.ctx.destination);
        boom.start(now);
        boom.stop(now + 0.45);
    }

    startFeverLoop() {
        this.stopFeverLoop();
        if (!this.enabled) return;
        this.init();
        this.feverBoost = true;

        const drone = this.ctx.createOscillator();
        const droneGain = this.ctx.createGain();
        drone.type = 'sawtooth';
        drone.frequency.setValueAtTime(52, this.ctx.currentTime);
        droneGain.gain.setValueAtTime(0.045, this.ctx.currentTime);
        drone.connect(droneGain);
        droneGain.connect(this.ctx.destination);
        drone.start();
        this._feverDrone = drone;
        this._feverDroneGain = droneGain;

        this._feverLoopTimer = setInterval(() => this.playFeverPulse(), 180);
    }

    playFeverPulse() {
        if (!this.enabled || !this.ctx) return;
        const now = this.ctx.currentTime;
        const chord = [523.25, 659.25, 783.99, 987.77];
        const freq = chord[Math.floor(Math.random() * chord.length)];
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + 0.12);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.18);
    }

    playFeverDrop() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(980 + Math.random() * 220, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.09);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
    }

    playFeverScore() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1320, now);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.08);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
    }

    playFeverEnd() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const notes = [1046.50, 783.99, 659.25, 523.25];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.07);
            gain.gain.setValueAtTime(0.16, now + idx * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.22);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.07);
            osc.stop(now + idx * 0.07 + 0.25);
        });
    }

    stopFeverLoop() {
        this.feverBoost = false;
        if (this._feverLoopTimer) {
            clearInterval(this._feverLoopTimer);
            this._feverLoopTimer = null;
        }
        if (this._feverDrone) {
            try {
                const now = this.ctx ? this.ctx.currentTime : 0;
                if (this._feverDroneGain && this.ctx) {
                    this._feverDroneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                }
                this._feverDrone.stop(now + 0.14);
            } catch (e) {
                // Already stopped.
            }
            this._feverDrone = null;
            this._feverDroneGain = null;
        }
    }

    playSlotFanfare() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        [392.00, 523.25, 659.25, 783.99].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.06);
            gain.gain.setValueAtTime(0.16, now + idx * 0.06);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.22);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.06);
            osc.stop(now + idx * 0.06 + 0.25);
        });
    }

    playSlotPull() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.16);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.2);
    }

    playSlotReelTick() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(620 + Math.random() * 80, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
    }

    playSlotReelStop() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.09);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
    }

    playSlotJackpot() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, now + idx * 0.07);
            gain.gain.setValueAtTime(0.18, now + idx * 0.07);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.28);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.07);
            osc.stop(now + idx * 0.07 + 0.3);
        });
    }

    playSlotPairWin() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        [659.25, 880.00].forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);
            gain.gain.setValueAtTime(0.16, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.2);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.22);
        });
    }

    playSlotMiss() {
        if (!this.enabled) return;
        this.init();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.linearRampToValueAtTime(140, now + 0.22);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now);
        osc.stop(now + 0.25);
    }
}

window.soundEngine = new SoundEngine();
