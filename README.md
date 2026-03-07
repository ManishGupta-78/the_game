# Portal Quest 🌀

An online board game for 1–4 players, inspired by Snakes & Ladders — but every square hides a **dynamic portal** that changes every time someone lands on it.

## Features

| Feature | Details |
|---------|---------|
| **Game modes** | Solo vs Computer AI · Online multiplayer (2–4 players) |
| **Dynamic portals** | Each square's type (solid / forward portal / backward portal) is re-rolled **every** time a player lands on it |
| **Random destinations** | Portal destinations are random (±1–25 squares) |
| **Collision** | Landing on an occupied square sends the previous player back to Start |
| **Win condition** | First to reach square 100 wins; game ends when only one player is left |
| **Controls** | Mouse click · Space / Enter key to roll |
| **Smooth graphics** | HTML5 Canvas with animated tokens, step-by-step movement, portal particle effects |

## Screens

### Lobby
![Lobby](https://github.com/user-attachments/assets/4589310b-03f8-4dee-961c-b02bdafb2002)

### Game Board (start of game)
![Board](https://github.com/user-attachments/assets/9972add5-a167-4a94-91b9-8a9efe86f78d)

### Portal in Action
![Portal](https://github.com/user-attachments/assets/8a0d2f6a-d372-4a43-b757-36e27c1cf90b)

## Tech Stack

- **Server**: Node.js · Express · Socket.io (real-time multiplayer)
- **Client**: Vanilla JavaScript · HTML5 Canvas
- **Styling**: Pure CSS3 (dark theme)

## Getting Started

```bash
npm install
npm start
# Open http://localhost:3000
```

## How to Play

1. Enter your name and choose **vs Computer** or **Create Game** (for online)
2. Share the room code with friends to let them join (online mode)
3. Click **Roll Dice** (or press **Space / Enter**) on your turn
4. Your token moves the rolled number of squares
5. When you land on a square, its portal type is revealed:
   - 🟢 **Green** = forward portal — you're teleported ahead!
   - 🔴 **Red** = backward portal — you're teleported back!
   - 🟤 **Tan** = solid — you stay put
6. If you land on a square occupied by another player, they're bumped back to Start
7. First to reach square **100** wins!
