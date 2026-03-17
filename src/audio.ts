/**
 * 音频系统类：使用程序化方式实时合成音效（无需加载外部 mp3 文件）
 */
class AudioSystem {
    private ctx: AudioContext | null = null;
    private initialized = false;

    /** 
     * 初始化音频上下文
     * 注意：现代浏览器要求必须由用户交互（如点击）触发音频系统的启动
     */
    public init() {
        if (this.initialized) return;
        try {
            this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.initialized = true;
        } catch (e) {
            console.warn('Web Audio API not supported');
        }
    }

    /**
     * 播放放置方块的“砰”声
     * 使用低频三角波振荡器模拟快速的撞击声
     */
    public playPop() {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator(); // 振荡器
        const g = this.ctx.createGain();       // 增益器（音量控制）

        o.type = 'triangle';
        // 频率从 150Hz 快速降到 40Hz，形成自然的“嘭”声
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.1);

        // 音量从 0.5 快速衰减到 0
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

        o.connect(g);
        g.connect(this.ctx.destination);
        o.start(t);
        o.stop(t + 0.1);
    }

    /**
     * 播放破坏方块的“咔嚓”声
     * 使用白噪声配合低通滤波器模拟沙石破碎的颗粒感
     */
    public playCrunch() {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const t = this.ctx.currentTime;

        // 手动创建一个白噪声缓冲区（150ms 长度）
        const bufferSize = this.ctx.sampleRate * 0.15;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1; // 填充随机噪声
        }

        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = buffer;

        // 使用双二阶滤波器处理噪声，使其听起来更像泥土
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, t);
        filter.frequency.exponentialRampToValueAtTime(100, t + 0.15);

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.6, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

        noiseSource.connect(filter);
        filter.connect(g);
        g.connect(this.ctx.destination);
        noiseSource.start(t);
    }
}

export const audioSystem = new AudioSystem();
