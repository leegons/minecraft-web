# 🌍 Block World (Minecraft Web)

[English Version](README_en.md) | [中文版本](README.md)

A high-performance web-based voxel sandbox game built with **Three.js**. This project is entirely code-driven, supporting terrain generation, building, day-night cycle, save system, and other core features without relying on external asset packages.

## ✨ Features

- 🌲 **Dynamic Terrain Generation**: Uses noise algorithms to generate mountains, plains, lakes, and forests.
- 🌓 **Dynamic Environment System**: Complete day-night cycle with sun and moon trajectories, starry sky, and dynamic cloud layers.
- 🧱 **Build & Mine**: Supports both Survival mode (limited resources) and Creative mode (unlimited resources).
- 💾 **Auto-Save**: Game state is automatically saved in real-time using `localStorage`.
- 🚀 **Performance Optimized**: Frustum culling, face culling, dynamic chunk loading, and instanced rendering ensure smooth performance in browsers.
- 📱 **Multi-Platform Support**: Works with keyboard/mouse on desktop and virtual joystick on mobile devices.
- 🎵 **Procedural Audio**: Real-time sound synthesis via Web Audio API without loading external audio files.

## 🕹️ Controls

### ⌨️ Desktop (PC)
- **W, A, S, D**: Move
- **Space**: Jump
- **Double-tap Space**: Toggle flight mode in Creative mode
- **Left Mouse Button**: Mine/Break blocks
- **Right Mouse Button**: Place blocks
- **Number keys 1-9**: Switch block types
- **F3**: Toggle debug information panel

### 📱 Mobile
- **Left Joystick**: Move
- **Right Area**: Swipe to look around
- **Bottom-right buttons**: Jump, Mine, Place

## 🛠️ Installation & Setup

Make sure you have [Node.js](https://nodejs.org/) installed on your computer.

1. **Clone the repository**
   ```bash
   git clone https://github.com/leegons/minecraft-web.git
   cd minecraft-web
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run development server**
   ```bash
   npm run dev
   ```

4. **Build production version**
   ```bash
   npm run build
   ```

## 📂 Project Structure

- `src/world.ts`: Core world logic and mesh construction
- `src/player.ts`: Player physics simulation and controls
- `src/sky.ts`: Sky and environment rendering
- `src/textures.ts`: Procedural texture generation
- `src/interaction.ts`: Raycasting interaction system

For detailed project structure, please check `artifacts/code_structure.md`.

---
*Have fun exploring your block world!*