import * as THREE from 'three';
import { Player } from './player';
import { World } from './world';
import { BlockType } from './constants';
import type { GameMode } from './constants';
import { Interaction } from './interaction';
import nipplejs from 'nipplejs';
import { NPC } from './npc';
import { Sky } from './sky';
import { ParticleSystem } from './particles';
import { audioSystem } from './audio';
import { Save } from './save';
import { Inventory } from './inventory';

// --- 基础场景设置 (全局) ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // 天蓝色背景
scene.fog = new THREE.Fog(0x87CEEB, 20, 100); // 线性雾效果

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // 环境光
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8); // 平行光（模拟太阳）
directionalLight.position.set(100, 200, 50);
scene.add(directionalLight);

const sky = new Sky(scene, renderer); // 天空系统
sky.time = 0.2;

// --- 窗口缩放处理 ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- UI 元素 ---
const instructions = document.getElementById('instructions');
const btnContinue = document.getElementById('btn-continue') as HTMLButtonElement | null;
const btnCreative = document.getElementById('btn-creative');
const btnFlat = document.getElementById('btn-flat');
const btnSurvival = document.getElementById('btn-survival');
const btnResetSave = document.getElementById('btn-reset-save');
const languageToggle = document.getElementById('language-toggle');

// 快捷栏槽位
const slots = [
  document.getElementById('slot-1'),
  document.getElementById('slot-2'),
  document.getElementById('slot-3'),
  document.getElementById('slot-4'),
  document.getElementById('slot-5'),
  document.getElementById('slot-6'),
];

// 槽位索引对应的方块类型
const slotBlockTypes = [
  BlockType.GRASS,
  BlockType.DIRT,
  BlockType.STONE,
  BlockType.WATER,
  BlockType.WOOD,
  BlockType.LEAVES,
];

// 在开始游戏时定义的变量
let world: World;
let player: Player;
let interaction: Interaction;
let particles: ParticleSystem;
let inventory: Inventory;
const npcs: NPC[] = [];

let gameStarted = false;
let animationFrameId: number | null = null;
let autoSaveTimer: number | null = null;
let desktopCleanup: (() => void) | null = null;
let mobileCleanup: (() => void) | null = null;

// --- 存档集成 ---
if (Save.hasAnySave() && btnContinue) {
  btnContinue.style.display = 'block';
}

btnContinue?.addEventListener('click', (e) => {
  e.stopPropagation();
  const saved = Save.loadLatestGame();
  if (saved) startGame(saved.mode, saved.inventory);
});

btnCreative?.addEventListener('click', (e) => {
  e.stopPropagation();
  startOrResumeGame('creative');
});
btnFlat?.addEventListener('click', (e) => {
  e.stopPropagation();
  startOrResumeGame('flat');
});
btnSurvival?.addEventListener('click', (e) => {
  e.stopPropagation();
  startOrResumeGame('survival');
});

document.getElementById('btn-reset-save')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (confirm('确认要永久删除所有存档和建筑吗？此操作不可恢复。')) {
    Save.clearAll();
    window.location.reload();
  }
});

// 语言切换功能
let currentLanguage = 'zh'; // 默认中文
if (languageToggle) {
  languageToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    currentLanguage = currentLanguage === 'zh' ? 'en' : 'zh';
    updateLanguage(currentLanguage);
  });
}

/**
 * 更新游戏界面语言
 */
function updateLanguage(lang: string) {
  if (lang === 'en') {
    // 英文模式 - 更新按钮文本
    if (btnContinue) btnContinue.textContent = 'Continue Last Game';
    if (btnCreative) btnCreative.textContent = 'Creative Mode';
    if (btnFlat) btnFlat.textContent = 'Flat World';
    if (btnSurvival) btnSurvival.textContent = 'Survival Mode';
    if (btnResetSave) btnResetSave.textContent = 'Clear All Saves';
    
    const title = document.querySelector('.title');
    const subtitle = document.querySelector('.subtitle');
    const controls = document.querySelector('.controls');
    
    if (title) title.textContent = 'My Block World';
    if (subtitle) subtitle.textContent = 'Choose game mode to start';
    if (controls) {
      controls.innerHTML = `
        <p><b>Creative Mode:</b> Double-tap space to fly, unlimited blocks</p>
        <p><b>Survival Mode:</b> Mine to get blocks, consume blocks to place</p>
        <p><b>General Controls:</b> WASD to move, Space to jump, mouse buttons to interact</p>
      `;
    }
    
    // F3 调试面板会在下一帧通过 updateDebugInfo() 刷新，无需手动翻译文本
  } else {
    // 中文模式 - 恢复原始文本
    if (btnContinue) btnContinue.textContent = '继续游戏';
    if (btnCreative) btnCreative.textContent = '创造模式';
    if (btnFlat) btnFlat.textContent = '平坦世界';
    if (btnSurvival) btnSurvival.textContent = '生存模式';
    if (btnResetSave) btnResetSave.textContent = '清空所有存档';
    
    const title = document.querySelector('.title');
    const subtitle = document.querySelector('.subtitle');
    const controls = document.querySelector('.controls');
    
    if (title) title.textContent = '我的方块世界';
    if (subtitle) subtitle.textContent = '选择游戏模式开始';
    if (controls) {
      controls.innerHTML = `
        <p><b>创造模式：</b>双击空格飞行，无限方块</p>
        <p><b>生存模式：</b>挖掘获得方块，消耗方块放置</p>
        <p><b>通用操作：</b>WASD 移动，空格跳跃，左右键操作</p>
      `;
    }
    
    // 如果面板正在显示，立即刷新为中文内容
    if (showDebug) updateDebugInfo();
  }
}

function startOrResumeGame(mode: GameMode) {
  const saved = Save.loadGame(mode);
  if (saved) {
    startGame(mode, saved.inventory);
    return;
  }
  startGame(mode);
}

/**
 * 初始化游戏引擎
 * @param mode 游戏模式
 * @param savedInventory 存档的背包数据
 */
function startGame(mode: GameMode, savedInventory?: Record<string, number>) {
  cleanupCurrentGame();
  gameStarted = true;
  if (instructions) instructions.style.display = 'none';

  // 1. 初始化世界
  world = new World(scene, mode);
  particles = new ParticleSystem(scene);

  // 2. 初始化背包
  inventory = new Inventory();
  if (savedInventory) inventory.fromJSON(savedInventory);

  // 生存模式初始物品
  if (mode === 'survival' && !savedInventory) {
    inventory.add(BlockType.DIRT, 10);
    inventory.add(BlockType.GRASS, 5);
  }

  // 3. 初始化玩家
  player = new Player(camera, document.body, world, mode);
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  if (isMobile) {
    document.body.classList.add('is-mobile');
    player.isMobile = true;
    // 移动端 UI 特殊模式处理
    const btnFly = document.getElementById('btn-fly');
    if (btnFly) btnFly.style.display = mode === 'creative' ? 'flex' : 'none';
    const btnDescend = document.getElementById('btn-descend');
    if (btnDescend) btnDescend.style.display = mode === 'creative' ? 'flex' : 'none';

    document.body.classList.add('playing');
    mobileCleanup = setupMobileControls();
  } else {
    desktopCleanup = setupDesktopControls();
    // 启动时立即请求指针锁定
    player.controls.lock();
  }

  // 4. 初始化交互逻辑 (挖掘/放置)
  interaction = new Interaction(world, player, particles, inventory, mode);
  interaction.setBlockType(slotBlockTypes[0]);

  // 5. 生成 NPC
  npcs.length = 0;
  const spawnPoints = [
    { x: 5, z: 5 }, { x: -5, z: 8 }, { x: 10, z: -3 },
    { x: -8, z: -6 }, { x: 3, z: -10 }, { x: -12, z: 3 },
  ];
  spawnPoints.forEach(({ x, z }, i) => {
    npcs.push(new NPC(world, x, z, i * 137 + 42));
  });

  // 6. 注册 UI 更新监听
  inventory.onChange = () => updateUI();
  updateUI();

  // 自动保存定时器 (每 10 秒)
  autoSaveTimer = window.setInterval(() => {
    Save.saveGame(mode, inventory);
  }, 10000);

  // 启动渲染循环
  animationFrameId = requestAnimationFrame(animate);
}

/**
 * 更新物品栏 UI 上的数量
 */
function updateUI() {
  slots.forEach((slot, idx) => {
    if (!slot) return;
    const countSpan = slot.querySelector('.count');
    if (countSpan) {
      if (world.mode === 'survival') {
        const count = inventory.get(slotBlockTypes[idx]);
        countSpan.textContent = count > 0 ? String(count) : '';
      } else {
        countSpan.textContent = '';
      }
    }
  });
}

/**
 * 切换选中的槽位高亮
 */
function updateHotbar(activeIndex: number) {
  slots.forEach((slot, index) => {
    if (slot) {
      if (index === activeIndex) slot.classList.add('active');
      else slot.classList.remove('active');
    }
  });
}

/**
 * 设置桌面端控制逻辑 (键盘/鼠标)
 */
function setupDesktopControls() {
  // 延迟监听点击，避免捕获“开始游戏”的点击
  const onClick = () => {
    if (gameStarted && !player.controls.isLocked) player.controls.lock();
  };
  const onLock = () => {
    document.body.classList.add('playing');
    if (instructions) instructions.style.display = 'none';
  };
  const onUnlock = () => {
    document.body.classList.remove('playing');
    if (instructions) instructions.style.display = 'flex';
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const idx = parseInt(e.key) - 1;
    if (idx >= 0 && idx < slotBlockTypes.length) {
      interaction.setBlockType(slotBlockTypes[idx]);
      updateHotbar(idx);
    }
  };

  const clickTimer = window.setTimeout(() => {
    document.addEventListener('click', onClick);
  }, 100);
  player.controls.addEventListener('lock', onLock);
  player.controls.addEventListener('unlock', onUnlock);
  document.addEventListener('keydown', onKeyDown);

  return () => {
    window.clearTimeout(clickTimer);
    document.removeEventListener('click', onClick);
    player.controls.removeEventListener('lock', onLock);
    player.controls.removeEventListener('unlock', onUnlock);
    document.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * 设置移动端控制逻辑 (虚拟摇杆/触摸)
 */
function setupMobileControls() {
  const cleanups: Array<() => void> = [];
  const joystickZone = document.getElementById('joystick-zone');
  if (joystickZone) {
    const manager: any = nipplejs.create({
      zone: joystickZone,
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'white'
    });
    manager.on('move', (_: any, data: any) => {
      player.joystickVector.set(data.vector.x, -data.vector.y);
    });
    manager.on('end', () => {
      player.joystickVector.set(0, 0);
    });
    cleanups.push(() => manager.destroy());
  }

  const lookZone = document.getElementById('touch-look-zone');
  let lastX = 0, lastY = 0;
  const onLookStart = (e: TouchEvent) => {
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
  };
  const onLookMove = (e: TouchEvent) => {
    e.preventDefault();
    const dx = e.touches[0].clientX - lastX;
    const dy = e.touches[0].clientY - lastY;
    player.rotateCamera(dx, dy);
    lastX = e.touches[0].clientX;
    lastY = e.touches[0].clientY;
  };
  lookZone?.addEventListener('touchstart', onLookStart);
  lookZone?.addEventListener('touchmove', onLookMove);
  if (lookZone) {
    cleanups.push(() => {
      lookZone.removeEventListener('touchstart', onLookStart);
      lookZone.removeEventListener('touchmove', onLookMove);
    });
  }

  const btnFly = document.getElementById('btn-fly');
  const onFly = (e: TouchEvent) => { e.preventDefault(); player.toggleFlight(); };
  btnFly?.addEventListener('touchstart', onFly);
  if (btnFly) cleanups.push(() => btnFly.removeEventListener('touchstart', onFly));

  const jumpBtn = document.getElementById('btn-jump');
  const onJumpStart = (e: TouchEvent) => {
    e.preventDefault();
    if (player.isFlying) player.flyUp = true;
    else player.jump();
  };
  const onJumpEnd = (e: TouchEvent) => {
    e.preventDefault();
    player.flyUp = false;
  };
  jumpBtn?.addEventListener('touchstart', onJumpStart);
  jumpBtn?.addEventListener('touchend', onJumpEnd);
  if (jumpBtn) cleanups.push(() => {
    jumpBtn.removeEventListener('touchstart', onJumpStart);
    jumpBtn.removeEventListener('touchend', onJumpEnd);
  });

  const descendBtn = document.getElementById('btn-descend');
  const onDescendStart = (e: TouchEvent) => {
    e.preventDefault();
    player.flyDown = true;
  };
  const onDescendEnd = (e: TouchEvent) => {
    e.preventDefault();
    player.flyDown = false;
  };
  descendBtn?.addEventListener('touchstart', onDescendStart);
  descendBtn?.addEventListener('touchend', onDescendEnd);
  if (descendBtn) cleanups.push(() => {
    descendBtn.removeEventListener('touchstart', onDescendStart);
    descendBtn.removeEventListener('touchend', onDescendEnd);
  });

  const breakBtn = document.getElementById('btn-break');
  const placeBtn = document.getElementById('btn-place');
  const onBreak = (e: TouchEvent) => { e.preventDefault(); interaction.interact(false); };
  const onPlace = (e: TouchEvent) => { e.preventDefault(); interaction.interact(true); };
  breakBtn?.addEventListener('touchstart', onBreak);
  placeBtn?.addEventListener('touchstart', onPlace);
  if (breakBtn) cleanups.push(() => breakBtn.removeEventListener('touchstart', onBreak));
  if (placeBtn) cleanups.push(() => placeBtn.removeEventListener('touchstart', onPlace));

  slots.forEach((slot, idx) => {
    if (!slot) return;
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      audioSystem.init(); // 初始化音频上下文（移动端限制）
      interaction.setBlockType(slotBlockTypes[idx]);
      updateHotbar(idx);
    };
    slot.addEventListener('touchstart', onTouchStart);
    cleanups.push(() => slot.removeEventListener('touchstart', onTouchStart));
  });

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

// --- 游戏循环 ---
const clock = new THREE.Clock();

function animate() {
  if (!gameStarted) {
    animationFrameId = null;
    return;
  }
  animationFrameId = requestAnimationFrame(animate);

  const delta = clock.getDelta();
  player.update(delta); // 更新玩家

  for (const npc of npcs) npc.update(delta, camera.position); // 更新 NPC
  particles.update(delta); // 更新粒子

  // 更新天空环境
  const lightIntensity = sky.update(delta, camera.position);
  ambientLight.intensity = 0.15 + lightIntensity * 0.55;
  directionalLight.intensity = lightIntensity * 1.0;

  interaction.update(); // 更新交互指示器
  world.update(camera.position); // 动态更新世界块加载

  // 仅在调试面板开启时才更新（避免每帧无效计算）
  if (showDebug) updateDebugInfo();

  renderer.render(scene, camera);
}

function cleanupCurrentGame() {
  if (!gameStarted) return;

  gameStarted = false;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (autoSaveTimer !== null) {
    window.clearInterval(autoSaveTimer);
    autoSaveTimer = null;
  }

  desktopCleanup?.();
  desktopCleanup = null;
  mobileCleanup?.();
  mobileCleanup = null;

  interaction?.dispose();
  particles?.dispose();
  for (const npc of npcs) npc.dispose();
  npcs.length = 0;
  player?.dispose();
  world?.dispose();
}

const f3DebugElement = document.getElementById('f3-debug');
let showDebug = false;
// 预分配方向向量，避免调试面板每帧 new THREE.Vector3()
const _debugDirection = new THREE.Vector3();

/**
 * 更新 F3 调试信息面板（仅在面板可见时调用）
 */
function updateDebugInfo() {
  if (!f3DebugElement) return;

  // XYZ 坐标
  const p = camera.position;
  const xyz = `坐标: ${p.x.toFixed(3)} / ${p.y.toFixed(3)} / ${p.z.toFixed(3)}`;

  // 方块坐标
  const block = `方块: ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;

  // 面向方向（复用预分配向量）
  camera.getWorldDirection(_debugDirection);
  let facing = '';
  const absX = Math.abs(_debugDirection.x);
  const absZ = Math.abs(_debugDirection.z);

  if (absX > absZ) {
    facing = _debugDirection.x > 0 ? '东 (+X)' : '西 (-X)';
  } else {
    facing = _debugDirection.z > 0 ? '南 (+Z)' : '北 (-Z)';
  }

  // 游戏时间
  const { hours, minutes } = sky.getClockTime();
  const timeStr = `时间: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

  f3DebugElement.innerText = `我的方块世界 (F3 调试)\n${xyz}\n${block}\n面向: ${facing}\n${timeStr}\n模式: ${world.mode === 'survival' ? '生存' : (world.mode === 'creative' ? '创造' : '平坦')}`;
}

// 绑定 F3 切换
document.addEventListener('keydown', (e) => {
  if (e.code === 'F3') {
    e.preventDefault();
    showDebug = !showDebug;
    if (f3DebugElement) {
      f3DebugElement.style.display = showDebug ? 'block' : 'none';
    }
  }
});
