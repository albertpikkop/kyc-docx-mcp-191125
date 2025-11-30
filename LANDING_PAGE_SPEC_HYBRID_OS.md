# 🖥️ MexKYC Landing Page — Hybrid OS Design Specification

> **Complete Documentation for Agent 2.0**
> Build a Windows OS-inspired landing page using Nano Banana Pro
> Version: 1.0 | Date: November 2025

---

## 📋 Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Philosophy](#2-design-philosophy)
3. [Design System](#3-design-system)
4. [Page Structure](#4-page-structure)
5. [Component Library](#5-component-library)
6. [Animations & Interactions](#6-animations--interactions)
7. [Content Copy](#7-content-copy)
8. [Nano Banana Pro Prompts](#8-nano-banana-pro-prompts)
9. [Responsive Behavior](#9-responsive-behavior)
10. [Technical Implementation](#10-technical-implementation)
11. [Asset Checklist](#11-asset-checklist)

---

## 1. Executive Summary

### 1.1 Product
**MexKYC** — AI-powered KYC document extraction for Mexican businesses. First solution that lets you "chat with your client data."

### 1.2 Target Audience
- Mexican fintechs, banks, financial institutions
- Compliance officers, operations managers
- CTOs and product managers at financial companies

### 1.3 Landing Page Objectives
1. **Communicate** the unique value proposition (conversational KYC)
2. **Demonstrate** the product through interactive OS-style demos
3. **Generate leads** for early access program
4. **Stand out** from generic enterprise software competitors

### 1.4 Design Concept: "Hybrid OS"
A modern dark fintech landing page where **UI elements are draggable windows**. The website IS the product demo — visitors interact with "windows" showing documents, chat, reports, etc.

**Tagline Concept:** *"Your KYC Desktop"* or *"The Operating System for Know Your Customer"*

---

## 2. Design Philosophy

### 2.1 Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Familiar yet Fresh** | Windows metaphor is familiar, but execution is modern |
| **Demo-First** | Every section is an interactive demo |
| **Trust Through Design** | Dark mode + glass = premium fintech feel |
| **Memorable** | Visitors remember "the OS-style KYC site" |
| **Conversion-Focused** | Clear CTAs, lead capture integrated |

### 2.2 Emotional Goals

```
Visitor Journey:
1. LAND → "Wow, this looks different" (curiosity)
2. EXPLORE → "I can drag these windows!" (delight)
3. UNDERSTAND → "Oh, I can chat with my data" (clarity)
4. TRUST → "This looks professional and serious" (confidence)
5. CONVERT → "I want to try this" (action)
```

### 2.3 Competitive Differentiation

| Competitors | Their Design | MexKYC Hybrid OS |
|-------------|--------------|------------------|
| Onfido | Generic SaaS blue | Dark, interactive OS |
| Truora | Light corporate | Immersive desktop experience |
| Mati (MetaMap) | Standard startup | Windows = product demo |
| INE API services | Government boring | Premium fintech aesthetic |

---

## 3. Design System

### 3.1 Color Palette

```css
:root {
  /* Backgrounds */
  --bg-desktop: #0a1628;           /* Main desktop background */
  --bg-desktop-gradient: linear-gradient(135deg, #0a1628 0%, #1e3a5f 50%, #0a1628 100%);
  --bg-window: rgba(30, 41, 59, 0.85);  /* Window background with transparency */
  --bg-window-solid: #1e293b;      /* Solid window background */
  --bg-taskbar: rgba(15, 23, 42, 0.95); /* Taskbar background */
  --bg-input: rgba(15, 23, 42, 0.8);    /* Input field background */
  
  /* Text */
  --text-primary: #f8fafc;         /* White text */
  --text-secondary: #94a3b8;       /* Gray text */
  --text-muted: #64748b;           /* Muted text */
  
  /* Accent Colors */
  --accent-blue: #3b82f6;          /* Primary accent */
  --accent-cyan: #22d3ee;          /* Secondary accent */
  --accent-purple: #8b5cf6;        /* Tertiary accent */
  --accent-green: #22c55e;         /* Success state */
  --accent-yellow: #f59e0b;        /* Warning state */
  --accent-red: #ef4444;           /* Error/close state */
  
  /* Window Controls (Traffic Light Style) */
  --control-close: #ff5f57;        /* Red */
  --control-minimize: #febc2e;     /* Yellow */
  --control-maximize: #28c840;     /* Green */
  
  /* Gradients */
  --gradient-blue-purple: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
  --gradient-cyan-blue: linear-gradient(135deg, #22d3ee 0%, #3b82f6 100%);
  --gradient-glass: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
  
  /* Borders */
  --border-window: rgba(255, 255, 255, 0.1);
  --border-window-active: rgba(59, 130, 246, 0.5);
  
  /* Shadows */
  --shadow-window: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  --shadow-window-hover: 0 35px 60px -15px rgba(0, 0, 0, 0.6);
  --shadow-glow-blue: 0 0 40px rgba(59, 130, 246, 0.3);
}
```

### 3.2 Typography

```css
/* Font Imports */
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');

:root {
  /* Font Families */
  --font-display: 'Space Grotesk', sans-serif;  /* Headlines, window titles */
  --font-body: 'Inter', sans-serif;              /* Body text */
  --font-mono: 'JetBrains Mono', monospace;      /* Code, data, numbers */
  
  /* Font Sizes */
  --text-xs: 0.75rem;      /* 12px */
  --text-sm: 0.875rem;     /* 14px */
  --text-base: 1rem;       /* 16px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.25rem;      /* 20px */
  --text-2xl: 1.5rem;      /* 24px */
  --text-3xl: 1.875rem;    /* 30px */
  --text-4xl: 2.25rem;     /* 36px */
  --text-5xl: 3rem;        /* 48px */
  --text-6xl: 3.75rem;     /* 60px */
  
  /* Line Heights */
  --leading-tight: 1.1;
  --leading-snug: 1.3;
  --leading-normal: 1.5;
  --leading-relaxed: 1.7;
  
  /* Font Weights */
  --font-normal: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;
}

/* Typography Classes */
.headline-hero {
  font-family: var(--font-display);
  font-size: clamp(2.5rem, 6vw, 4rem);
  font-weight: var(--font-bold);
  line-height: var(--leading-tight);
  letter-spacing: -0.02em;
}

.headline-section {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
}

.window-title {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  letter-spacing: 0.01em;
}

.body-text {
  font-family: var(--font-body);
  font-size: var(--text-base);
  font-weight: var(--font-normal);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary);
}

.data-text {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: var(--font-normal);
}

.stat-number {
  font-family: var(--font-mono);
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  color: var(--accent-cyan);
}
```

### 3.3 Spacing System

```css
:root {
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  --space-20: 5rem;     /* 80px */
  --space-24: 6rem;     /* 96px */
}
```

### 3.4 Border Radius

```css
:root {
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-full: 9999px;
  
  /* Window-specific */
  --radius-window: 12px;
  --radius-window-content: 0 0 12px 12px;
}
```

---

## 4. Page Structure

### 4.1 Overall Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                        DESKTOP VIEWPORT                          │
│  (Full viewport height, gradient background)                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      HERO SECTION                          │ │
│  │  - Floating windows with product preview                   │ │
│  │  - Main headline + subheadline                             │ │
│  │  - CTA buttons                                             │ │
│  │  - Stats bar                                               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    FEATURES SECTION                        │ │
│  │  - Feature windows (draggable)                             │ │
│  │  - Each feature is an "app window"                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  CHAT DEMO SECTION                         │ │
│  │  - Interactive chat window                                 │ │
│  │  - Pre-filled conversation demo                            │ │
│  │  - User can type (simulated responses)                     │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                 DOCUMENTS SECTION                          │ │
│  │  - Document type "icons" on desktop                        │ │
│  │  - Click to open window with details                       │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    DEMO SECTION                            │ │
│  │  - Video window showing product demo                       │ │
│  │  - Or interactive extraction demo                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    CTA SECTION                             │ │
│  │  - "Start" menu style popup                                │ │
│  │  - Lead capture form in window                             │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  │ 🚀 MexKYC │ 📁 Docs │ 💬 Chat │ 📊 Demo │ 📧 Contact │     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                         TASKBAR (Fixed)                          │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Section Breakdown

#### Section 1: Hero (100vh)
- Background: Animated gradient or Nano Banana video loop
- Floating windows showing product preview
- Main headline with gradient text
- Two CTA buttons
- Stats in "notification" style cards

#### Section 2: Features (auto height)
- 6 feature "windows" in grid
- Each window is draggable (optional)
- Windows have: icon, title, description
- Hover state: lift + glow

#### Section 3: Chat Demo (100vh)
- Large chat window (centered)
- Pre-populated conversation
- Input field at bottom
- Optional: typing simulation on scroll

#### Section 4: Supported Documents (auto height)
- Desktop icon grid
- 8 document type icons
- Click opens info window (modal)

#### Section 5: Video Demo (80vh)
- Video player in window frame
- Nano Banana generated video
- Play button overlay

#### Section 6: CTA / Lead Capture (60vh)
- "Start Menu" style popup
- Email capture form
- "Request Early Access" CTA

#### Fixed: Taskbar
- Always visible at bottom
- Navigation items as taskbar buttons
- "Start" button with MexKYC logo
- Clock showing current time (real)

---

## 5. Component Library

### 5.1 Window Component

```html
<!-- Window Component Structure -->
<div class="os-window" data-window-id="unique-id">
  <!-- Window Header (Draggable Handle) -->
  <div class="os-window__header">
    <div class="os-window__controls">
      <button class="os-window__control os-window__control--close" aria-label="Close"></button>
      <button class="os-window__control os-window__control--minimize" aria-label="Minimize"></button>
      <button class="os-window__control os-window__control--maximize" aria-label="Maximize"></button>
    </div>
    <div class="os-window__title">
      <span class="os-window__icon">📄</span>
      <span class="os-window__title-text">Window Title</span>
    </div>
    <div class="os-window__actions">
      <!-- Optional action buttons -->
    </div>
  </div>
  
  <!-- Window Content -->
  <div class="os-window__content">
    <!-- Any content goes here -->
  </div>
  
  <!-- Optional: Window Footer/Status Bar -->
  <div class="os-window__footer">
    <span class="os-window__status">Ready</span>
  </div>
</div>
```

```css
/* Window Component Styles */
.os-window {
  position: relative;
  background: var(--bg-window);
  border: 1px solid var(--border-window);
  border-radius: var(--radius-window);
  box-shadow: var(--shadow-window);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}

.os-window:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-window-hover);
}

.os-window--active {
  border-color: var(--border-window-active);
  box-shadow: var(--shadow-window), var(--shadow-glow-blue);
}

.os-window--dragging {
  cursor: grabbing;
  opacity: 0.95;
  transform: scale(1.02);
}

/* Window Header */
.os-window__header {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--border-window);
  cursor: grab;
  user-select: none;
}

.os-window__controls {
  display: flex;
  gap: var(--space-2);
  margin-right: var(--space-4);
}

.os-window__control {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.os-window__control:hover {
  opacity: 0.8;
}

.os-window__control--close {
  background: var(--control-close);
}

.os-window__control--minimize {
  background: var(--control-minimize);
}

.os-window__control--maximize {
  background: var(--control-maximize);
}

.os-window__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
}

.os-window__icon {
  font-size: var(--text-base);
}

.os-window__title-text {
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

/* Window Content */
.os-window__content {
  padding: var(--space-6);
}

/* Window Footer */
.os-window__footer {
  padding: var(--space-2) var(--space-4);
  background: rgba(0, 0, 0, 0.1);
  border-top: 1px solid var(--border-window);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* Window Sizes */
.os-window--sm {
  width: 320px;
}

.os-window--md {
  width: 480px;
}

.os-window--lg {
  width: 640px;
}

.os-window--xl {
  width: 800px;
}

.os-window--full {
  width: 100%;
  max-width: 1000px;
}
```

### 5.2 Taskbar Component

```html
<!-- Taskbar Component -->
<nav class="os-taskbar" role="navigation">
  <div class="os-taskbar__start">
    <button class="os-taskbar__start-btn" aria-label="Start Menu">
      <span class="os-taskbar__logo">🚀</span>
      <span class="os-taskbar__brand">MexKYC</span>
    </button>
  </div>
  
  <div class="os-taskbar__apps">
    <button class="os-taskbar__app os-taskbar__app--active" data-section="hero">
      <span class="os-taskbar__app-icon">🏠</span>
      <span class="os-taskbar__app-label">Inicio</span>
    </button>
    <button class="os-taskbar__app" data-section="features">
      <span class="os-taskbar__app-icon">⚡</span>
      <span class="os-taskbar__app-label">Features</span>
    </button>
    <button class="os-taskbar__app" data-section="chat">
      <span class="os-taskbar__app-icon">💬</span>
      <span class="os-taskbar__app-label">Chat Demo</span>
    </button>
    <button class="os-taskbar__app" data-section="documents">
      <span class="os-taskbar__app-icon">📁</span>
      <span class="os-taskbar__app-label">Documentos</span>
    </button>
    <button class="os-taskbar__app" data-section="demo">
      <span class="os-taskbar__app-icon">▶️</span>
      <span class="os-taskbar__app-label">Demo</span>
    </button>
  </div>
  
  <div class="os-taskbar__tray">
    <div class="os-taskbar__tray-item">
      <span class="os-taskbar__notification">3</span>
      <span class="os-taskbar__tray-icon">🔔</span>
    </div>
    <div class="os-taskbar__clock" id="taskbar-clock">
      10:42 AM
    </div>
  </div>
</nav>
```

```css
/* Taskbar Styles */
.os-taskbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: var(--bg-taskbar);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border-window);
  display: flex;
  align-items: center;
  padding: 0 var(--space-4);
  z-index: 1000;
}

.os-taskbar__start {
  margin-right: var(--space-6);
}

.os-taskbar__start-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--gradient-blue-purple);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-family: var(--font-display);
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.os-taskbar__start-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
}

.os-taskbar__apps {
  display: flex;
  gap: var(--space-1);
  flex: 1;
}

.os-taskbar__app {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.os-taskbar__app:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.os-taskbar__app--active {
  background: rgba(59, 130, 246, 0.2);
  color: var(--accent-blue);
}

.os-taskbar__app--active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  background: var(--accent-blue);
  border-radius: var(--radius-full);
}

.os-taskbar__tray {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.os-taskbar__clock {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.os-taskbar__notification {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  background: var(--accent-red);
  border-radius: 50%;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}
```

### 5.3 Desktop Icon Component

```html
<!-- Desktop Icon -->
<button class="os-icon" data-document="acta">
  <div class="os-icon__image">
    <img src="images/icon-acta.png" alt="Acta Constitutiva">
  </div>
  <span class="os-icon__label">Acta Constitutiva</span>
</button>
```

```css
.os-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  background: transparent;
  border: 2px solid transparent;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100px;
}

.os-icon:hover {
  background: rgba(255, 255, 255, 0.05);
}

.os-icon:focus,
.os-icon--selected {
  background: rgba(59, 130, 246, 0.2);
  border-color: var(--accent-blue);
}

.os-icon__image {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
}

.os-icon__image img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.os-icon__label {
  font-family: var(--font-body);
  font-size: var(--text-xs);
  color: var(--text-primary);
  text-align: center;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  word-break: break-word;
  max-width: 80px;
}
```

### 5.4 Chat Message Component

```html
<!-- Chat Window Content -->
<div class="os-chat">
  <div class="os-chat__messages">
    <!-- User Message -->
    <div class="os-chat__message os-chat__message--user">
      <div class="os-chat__bubble">
        ¿Quiénes son los accionistas de esta empresa?
      </div>
    </div>
    
    <!-- AI Message -->
    <div class="os-chat__message os-chat__message--ai">
      <div class="os-chat__avatar">🤖</div>
      <div class="os-chat__bubble">
        <strong>Accionistas de Grupo Ejemplo S.A. de C.V.:</strong>
        <div class="os-chat__data">
          <div class="os-chat__data-row">
            <span class="os-chat__data-name">Juan Pérez García</span>
            <span class="os-chat__data-value">45%</span>
          </div>
          <div class="os-chat__data-row">
            <span class="os-chat__data-name">María López Ruiz</span>
            <span class="os-chat__data-value">35%</span>
          </div>
          <div class="os-chat__data-row">
            <span class="os-chat__data-name">Carlos Mendoza S.</span>
            <span class="os-chat__data-value">20%</span>
          </div>
        </div>
        <div class="os-chat__source">
          📄 Fuente: Acta Constitutiva (pág. 3)
        </div>
      </div>
    </div>
  </div>
  
  <!-- Chat Input -->
  <div class="os-chat__input-area">
    <input 
      type="text" 
      class="os-chat__input" 
      placeholder="Escribe tu pregunta..."
      aria-label="Pregunta"
    >
    <button class="os-chat__send" aria-label="Enviar">
      <span>➤</span>
    </button>
  </div>
</div>
```

```css
.os-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.os-chat__messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.os-chat__message {
  display: flex;
  gap: var(--space-3);
  max-width: 85%;
}

.os-chat__message--user {
  align-self: flex-end;
}

.os-chat__message--ai {
  align-self: flex-start;
}

.os-chat__avatar {
  width: 32px;
  height: 32px;
  background: var(--gradient-cyan-blue);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  flex-shrink: 0;
}

.os-chat__bubble {
  padding: var(--space-4);
  border-radius: var(--radius-xl);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.os-chat__message--user .os-chat__bubble {
  background: var(--accent-blue);
  color: white;
  border-bottom-right-radius: var(--radius-sm);
}

.os-chat__message--ai .os-chat__bubble {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: var(--text-primary);
  border-bottom-left-radius: var(--radius-sm);
}

.os-chat__data {
  margin-top: var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.os-chat__data-row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.os-chat__data-value {
  color: var(--accent-cyan);
  font-weight: var(--font-semibold);
}

.os-chat__source {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.os-chat__input-area {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-4);
  border-top: 1px solid var(--border-window);
}

.os-chat__input {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-input);
  border: 1px solid var(--border-window);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: var(--text-sm);
}

.os-chat__input:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.os-chat__send {
  width: 44px;
  height: 44px;
  background: var(--gradient-blue-purple);
  border: none;
  border-radius: var(--radius-lg);
  color: white;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.os-chat__send:hover {
  transform: scale(1.05);
}
```

### 5.5 Button Components

```html
<!-- Primary Button -->
<button class="os-btn os-btn--primary">
  <span>Solicitar Acceso</span>
  <span class="os-btn__icon">→</span>
</button>

<!-- Secondary Button -->
<button class="os-btn os-btn--secondary">
  <span>Ver Demo</span>
</button>

<!-- Ghost Button -->
<button class="os-btn os-btn--ghost">
  <span>Más información</span>
</button>
```

```css
.os-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-lg);
  font-family: var(--font-display);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
  border: none;
}

.os-btn--primary {
  background: var(--gradient-blue-purple);
  color: white;
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
}

.os-btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 30px rgba(59, 130, 246, 0.5);
}

.os-btn--secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--text-secondary);
}

.os-btn--secondary:hover {
  border-color: var(--accent-cyan);
  color: var(--accent-cyan);
}

.os-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
  padding: var(--space-2) var(--space-4);
}

.os-btn--ghost:hover {
  color: var(--text-primary);
}

.os-btn__icon {
  transition: transform 0.3s ease;
}

.os-btn:hover .os-btn__icon {
  transform: translateX(4px);
}
```

---

## 6. Animations & Interactions

### 6.1 Animation Keyframes

```css
/* Fade In Up - For sections/windows appearing */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Fade In Scale - For windows opening */
@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Float - For hero elements */
@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

/* Pulse Glow - For CTAs */
@keyframes pulseGlow {
  0%, 100% {
    box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
  }
  50% {
    box-shadow: 0 4px 40px rgba(59, 130, 246, 0.6);
  }
}

/* Typing Cursor */
@keyframes blink {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* Scan Line - For document scanning effect */
@keyframes scanLine {
  0% {
    top: 0;
  }
  100% {
    top: 100%;
  }
}

/* Data Flow - For particles */
@keyframes dataFlow {
  0% {
    transform: translateX(-100%);
    opacity: 0;
  }
  10% {
    opacity: 1;
  }
  90% {
    opacity: 1;
  }
  100% {
    transform: translateX(100%);
    opacity: 0;
  }
}
```

### 6.2 Animation Classes

```css
/* Apply animations */
.animate-fade-in-up {
  animation: fadeInUp 0.6s ease forwards;
}

.animate-fade-in-scale {
  animation: fadeInScale 0.4s ease forwards;
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

.animate-pulse-glow {
  animation: pulseGlow 2s ease-in-out infinite;
}

/* Staggered delays */
.delay-100 { animation-delay: 0.1s; }
.delay-200 { animation-delay: 0.2s; }
.delay-300 { animation-delay: 0.3s; }
.delay-400 { animation-delay: 0.4s; }
.delay-500 { animation-delay: 0.5s; }

/* Scroll-triggered (add via JS) */
.animate-on-scroll {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.animate-on-scroll.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```

### 6.3 Interaction Behaviors

```javascript
// Window Dragging (Vanilla JS)
class DraggableWindow {
  constructor(element) {
    this.window = element;
    this.header = element.querySelector('.os-window__header');
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.startLeft = 0;
    this.startTop = 0;
    
    this.init();
  }
  
  init() {
    this.header.addEventListener('mousedown', this.startDrag.bind(this));
    document.addEventListener('mousemove', this.drag.bind(this));
    document.addEventListener('mouseup', this.stopDrag.bind(this));
  }
  
  startDrag(e) {
    if (e.target.classList.contains('os-window__control')) return;
    
    this.isDragging = true;
    this.window.classList.add('os-window--dragging');
    
    const rect = this.window.getBoundingClientRect();
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startLeft = rect.left;
    this.startTop = rect.top;
    
    // Bring to front
    document.querySelectorAll('.os-window').forEach(w => w.style.zIndex = '1');
    this.window.style.zIndex = '10';
  }
  
  drag(e) {
    if (!this.isDragging) return;
    
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    
    this.window.style.position = 'fixed';
    this.window.style.left = `${this.startLeft + dx}px`;
    this.window.style.top = `${this.startTop + dy}px`;
  }
  
  stopDrag() {
    this.isDragging = false;
    this.window.classList.remove('os-window--dragging');
  }
}

// Initialize draggable windows
document.querySelectorAll('.os-window[data-draggable]').forEach(window => {
  new DraggableWindow(window);
});
```

```javascript
// Chat Demo Interaction
class ChatDemo {
  constructor(element) {
    this.chat = element;
    this.input = element.querySelector('.os-chat__input');
    this.sendBtn = element.querySelector('.os-chat__send');
    this.messages = element.querySelector('.os-chat__messages');
    
    this.demoResponses = {
      'accionistas': {
        text: 'Los accionistas de la empresa son:',
        data: [
          { name: 'Juan Pérez García', value: '45%' },
          { name: 'María López Ruiz', value: '35%' },
          { name: 'Carlos Mendoza S.', value: '20%' }
        ],
        source: 'Acta Constitutiva (pág. 3)'
      },
      'rfc': {
        text: 'El RFC de la empresa es:',
        data: [{ name: 'RFC', value: 'GFE180524HY7' }],
        source: 'Constancia SAT'
      },
      'representante': {
        text: 'El representante legal es:',
        data: [
          { name: 'Nombre', value: 'Juan Pérez García' },
          { name: 'Cargo', value: 'Apoderado General' }
        ],
        source: 'Acta Constitutiva (pág. 8)'
      },
      'default': {
        text: 'Puedo ayudarte con información sobre accionistas, RFC, representantes legales, facultades, y más. ¿Qué te gustaría saber?',
        data: [],
        source: null
      }
    };
    
    this.init();
  }
  
  init() {
    this.sendBtn.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.handleSend();
    });
  }
  
  handleSend() {
    const text = this.input.value.trim();
    if (!text) return;
    
    this.addMessage(text, 'user');
    this.input.value = '';
    
    // Show typing indicator
    setTimeout(() => {
      const response = this.getResponse(text);
      this.addMessage(response, 'ai');
    }, 1000);
  }
  
  getResponse(text) {
    const lower = text.toLowerCase();
    if (lower.includes('accionista') || lower.includes('socio')) {
      return this.demoResponses.accionistas;
    }
    if (lower.includes('rfc') || lower.includes('fiscal')) {
      return this.demoResponses.rfc;
    }
    if (lower.includes('representante') || lower.includes('apoderado')) {
      return this.demoResponses.representante;
    }
    return this.demoResponses.default;
  }
  
  addMessage(content, type) {
    const messageEl = document.createElement('div');
    messageEl.className = `os-chat__message os-chat__message--${type}`;
    
    if (type === 'user') {
      messageEl.innerHTML = `
        <div class="os-chat__bubble">${content}</div>
      `;
    } else {
      let dataHtml = '';
      if (content.data.length > 0) {
        dataHtml = `
          <div class="os-chat__data">
            ${content.data.map(d => `
              <div class="os-chat__data-row">
                <span class="os-chat__data-name">${d.name}</span>
                <span class="os-chat__data-value">${d.value}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      
      let sourceHtml = content.source 
        ? `<div class="os-chat__source">📄 Fuente: ${content.source}</div>` 
        : '';
      
      messageEl.innerHTML = `
        <div class="os-chat__avatar">🤖</div>
        <div class="os-chat__bubble">
          ${content.text}
          ${dataHtml}
          ${sourceHtml}
        </div>
      `;
    }
    
    this.messages.appendChild(messageEl);
    this.messages.scrollTop = this.messages.scrollHeight;
  }
}

// Initialize chat demo
document.querySelectorAll('.os-chat').forEach(chat => {
  new ChatDemo(chat);
});
```

```javascript
// Scroll-triggered animations
const observerOptions = {
  root: null,
  rootMargin: '0px',
  threshold: 0.1
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
    }
  });
}, observerOptions);

document.querySelectorAll('.animate-on-scroll').forEach(el => {
  observer.observe(el);
});
```

```javascript
// Taskbar clock
function updateClock() {
  const clock = document.getElementById('taskbar-clock');
  if (clock) {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

setInterval(updateClock, 1000);
updateClock();
```

---

## 7. Content Copy

### 7.1 Hero Section

```
BADGE: 🚀 Primera solución KYC conversacional en México

HEADLINE: 
Conoce a tus clientes.
Conversa con sus datos.

SUBHEADLINE:
Extracción automática de documentos mexicanos con IA.
Pregunta lo que quieras sobre tus clientes en lenguaje natural.

CTA PRIMARY: Solicitar Acceso Anticipado →
CTA SECONDARY: Ver Demo en Vivo

STATS:
- 3 min | Tiempo promedio KYC
- 99.2% | Precisión de extracción
- 8+ | Tipos de documentos
- $0 | Costo de implementación
```

### 7.2 Features Section

```
SECTION TITLE: ¿Por qué MexKYC?
SECTION SUBTITLE: La única solución diseñada específicamente para documentos mexicanos

FEATURE 1:
Icon: 💬
Title: Habla con tus Datos
Description: Pregunta en español: "¿Quiénes son los accionistas?" y obtén respuestas instantáneas de los documentos de tu cliente.

FEATURE 2:
Icon: 📄
Title: Documentos Mexicanos
Description: Acta Constitutiva, Constancia SAT, INE, FM2, CFE, TELMEX, estados de cuenta. Todo automatizado.

FEATURE 3:
Icon: ⚡
Title: 3 Minutos, No 3 Días
Description: Reduce el tiempo de onboarding de días a minutos. Tu equipo se enfoca en decisiones, no en captura.

FEATURE 4:
Icon: 🔒
Title: Compliance Automático
Description: Validación automática de RFC, detección de inconsistencias, alertas de riesgo. Todo documentado.

FEATURE 5:
Icon: 🔌
Title: API Simple
Description: Integra en tu sistema existente con nuestra API REST. Documentación clara, SDKs disponibles.

FEATURE 6:
Icon: 📊
Title: Reportes Ejecutivos
Description: Genera reportes KYC completos en PDF automáticamente. Listos para auditoría.
```

### 7.3 Chat Demo Section

```
SECTION TITLE: Conversa con los datos de tu cliente
SECTION SUBTITLE: Después de cargar los documentos, simplemente pregunta lo que necesitas saber. Sin buscar en PDFs, sin copiar y pegar.

EXAMPLE QUESTIONS:
- "¿Cuál es el RFC de la empresa?"
- "¿Quién es el representante legal?"
- "¿Cuáles son las facultades del apoderado?"
- "¿Hay inconsistencias en los documentos?"

CHAT DEMO CONVERSATION:
User: ¿Quiénes son los accionistas de esta empresa?
AI: Accionistas de Grupo Ejemplo S.A. de C.V.:
    • Juan Pérez García — 45%
    • María López Ruiz — 35%
    • Carlos Mendoza S. — 20%
    📄 Fuente: Acta Constitutiva (pág. 3)
```

### 7.4 Supported Documents Section

```
SECTION TITLE: Documentos Soportados
SECTION SUBTITLE: Extracción automática de todos los documentos KYC mexicanos

DOCUMENTS:
1. 📜 Acta Constitutiva | Datos societarios, poderes, accionistas
2. 🏛️ Constancia SAT | RFC, régimen fiscal, domicilio
3. 🪪 INE / IFE | Identificación oficial vigente
4. ✈️ FM2 / FM3 | Documento migratorio
5. 💡 CFE | Comprobante de domicilio
6. 📞 TELMEX | Comprobante de domicilio
7. 🏦 Estados de Cuenta | Bancarios, últimos 3 meses
8. 🛂 Pasaporte | Mexicano o extranjero
```

### 7.5 CTA Section

```
HEADLINE: ¿Listo para automatizar tu KYC?
SUBHEADLINE: Únete a las primeras 25 empresas en acceso anticipado. Sin costo de implementación.

CTA: Solicitar Acceso →

FORM FIELDS:
- Nombre completo
- Email corporativo
- Empresa
- ¿Cuántos KYCs procesas al mes? (dropdown: <50, 50-200, 200-1000, 1000+)
```

### 7.6 Footer

```
© 2025 MexKYC. Hecho en México 🇲🇽
Conoce a tus clientes. Conversa con sus datos.

LINKS: Términos | Privacidad | Contacto
```

---

## 8. Nano Banana Pro Prompts

### 8.1 Image Generation Prompts

```
IMAGE 1: Hero Background
-----------------------
Prompt: Create a stunning dark abstract background for a fintech landing page. 
Flowing data streams and particles moving from left to right. 
Glowing blue (#3b82f6) and cyan (#22d3ee) orbs connected by thin luminescent lines.
Subtle grid pattern in the background. Deep navy (#0a1628) base color.
4K resolution, cinematic lighting, modern tech aesthetic.
Aspect Ratio: 16:9

IMAGE 2: Document Extraction Visualization
------------------------------------------
Prompt: Photorealistic visualization of AI scanning a Mexican legal document (Acta Constitutiva).
Physical paper document with official notary seals visible.
Holographic blue scan lines moving across the document.
Glowing data extraction boxes floating above showing extracted text fields.
Dark background, dramatic lighting, sci-fi aesthetic.
4K resolution.
Aspect Ratio: 16:9

IMAGE 3: Chat Interface Preview
-------------------------------
Prompt: Modern AI chat interface mockup for business data queries.
Dark theme glassmorphism design.
Show conversation with user question in blue bubble and AI response with data table.
Spanish text: "¿Quiénes son los accionistas?"
Clean UI/UX, professional SaaS product aesthetic.
High resolution.
Aspect Ratio: 4:3

IMAGE 4: Dashboard Preview
--------------------------
Prompt: KYC compliance dashboard UI mockup with dark theme.
Left sidebar with navigation icons.
Main area showing document verification status cards with green checkmarks.
Risk score gauge showing "Bajo Riesgo" in green.
Company profile summary panel.
Glassmorphism cards, modern SaaS design.
Colors: dark slate (#1e293b), blue (#3b82f6), green (#22c55e).
4K resolution, pixel-perfect UI.
Aspect Ratio: 16:9

IMAGE 5: Mexico Network Map
---------------------------
Prompt: Stylized geometric map of Mexico showing nationwide fintech coverage.
Abstract low-poly design with glowing connection nodes at major cities.
Mexico City, Monterrey, Guadalajara, Tijuana highlighted.
Network lines connecting business hubs.
Dark background, turquoise (#14b8a6) nodes, gold (#f59e0b) connections.
Modern data visualization style.
Aspect Ratio: 16:9

IMAGE 6: Security Badge
-----------------------
Prompt: Data security visualization for fintech compliance.
Central glowing shield icon with lock symbol.
Floating certification badges and compliance icons surrounding.
Encrypted data streams and binary code in background.
Deep blue (#1e40af) to purple (#7c3aed) gradient.
Professional, enterprise-grade aesthetic.
Square format, icon style.
Aspect Ratio: 1:1

IMAGE 7: Before/After Comparison
--------------------------------
Prompt: Split-screen marketing comparison graphic.
LEFT SIDE (Before): Messy desk with paper documents, stressed businessperson silhouette, red warning icons, clock showing long time, dull gray colors.
RIGHT SIDE (After): Clean digital dashboard, happy professional, green checkmarks, fast clock, bright blue and white modern aesthetic.
Clear vertical dividing line.
Professional marketing style, persuasive.
Aspect Ratio: 16:9

IMAGE 8: Desktop Icons Set
--------------------------
Prompt: Set of 8 document type icons for a desktop-style interface.
Icons for: Acta Constitutiva (scroll), SAT Constancia (government building), INE (ID card), FM2 (passport), CFE (lightbulb), TELMEX (phone), Bank Statement (bank), Passport (passport book).
Consistent style: rounded corners, subtle gradients, dark theme friendly.
Each icon should be distinct and recognizable.
Professional, modern iconography.
Aspect Ratio: 1:1 (for each icon)
```

### 8.2 Video/Animation Prompts

```
VIDEO 1: Hero Background Loop (5 seconds)
-----------------------------------------
Prompt: Seamless looping animation of abstract data particles flowing.
Glowing blue and cyan orbs moving smoothly from left to right.
Thin connection lines forming and breaking.
Subtle pulsing grid in background.
Dark navy (#0a1628) background.
Slow, elegant, hypnotic movement.
1080p, 30fps, seamless loop.

VIDEO 2: Document Scan Animation (4 seconds)
--------------------------------------------
Prompt: Animation of AI scanning a document.
Sequence: Document appears → Blue scan line moves top to bottom → Data fields light up and float out → Clean extracted data display.
Futuristic holographic effects.
Blue scan line, glowing extracted data boxes.
1080p, smooth transitions.

VIDEO 3: Chat Conversation Demo (6 seconds)
-------------------------------------------
Prompt: Animation showing AI chat interaction.
Sequence: User types question → Typing indicator appears → AI response fades in with structured data → Data highlights one by one.
Modern chat UI, smooth transitions.
Dark theme, blue user messages, green AI responses.
1080p, realistic typing animation.

VIDEO 4: Data Transformation (5 seconds)
----------------------------------------
Prompt: Abstract animation of documents becoming digital data.
Paper documents dissolve into particles.
Particles flow and reform into organized JSON/data cards.
Warm paper tones transitioning to cool digital blues.
Elegant, satisfying transformation effect.
1080p, smooth particle physics.

VIDEO 5: Logo Reveal (3 seconds)
--------------------------------
Prompt: Premium logo reveal animation for "MexKYC".
Particles converge from edges of screen.
Form the text "MexKYC" in modern sans-serif.
Subtle blue glow pulse on completion.
Tagline fades in below: "Know Your Customer. Instantly."
Dark background, white text, blue accents.
1080p, tech startup aesthetic.
```

---

## 9. Responsive Behavior

### 9.1 Breakpoints

```css
/* Breakpoint System */
:root {
  --bp-sm: 640px;   /* Mobile landscape */
  --bp-md: 768px;   /* Tablet */
  --bp-lg: 1024px;  /* Desktop */
  --bp-xl: 1280px;  /* Large desktop */
  --bp-2xl: 1536px; /* Extra large */
}

/* Media Query Mixins (use in CSS) */
@media (max-width: 767px) { /* Mobile */ }
@media (min-width: 768px) and (max-width: 1023px) { /* Tablet */ }
@media (min-width: 1024px) { /* Desktop */ }
```

### 9.2 Responsive Behavior Rules

```
DESKTOP (1024px+):
- Full OS experience with draggable windows
- Taskbar fixed at bottom
- Windows can overlap and be repositioned
- Hero shows multiple floating windows
- Feature grid: 3 columns
- Chat window: side-by-side layout

TABLET (768px - 1023px):
- Windows stack vertically
- Dragging disabled
- Taskbar simplified (icons only)
- Hero shows single window
- Feature grid: 2 columns
- Chat window: full width

MOBILE (< 768px):
- Windows become full-width cards
- No window chrome (simplified)
- Taskbar becomes bottom navigation
- Hero: stacked layout, smaller text
- Feature grid: 1 column
- Chat window: full screen modal style
```

### 9.3 Mobile-Specific Styles

```css
@media (max-width: 767px) {
  /* Hide window controls on mobile */
  .os-window__controls {
    display: none;
  }
  
  /* Full-width windows */
  .os-window {
    width: 100%;
    margin: var(--space-4) 0;
    border-radius: var(--radius-lg);
  }
  
  /* Simplified taskbar */
  .os-taskbar {
    height: 64px;
    padding: 0;
    justify-content: space-around;
  }
  
  .os-taskbar__start,
  .os-taskbar__tray {
    display: none;
  }
  
  .os-taskbar__app-label {
    display: none;
  }
  
  .os-taskbar__app-icon {
    font-size: 24px;
  }
  
  /* Hero adjustments */
  .hero {
    padding: var(--space-6);
    text-align: center;
  }
  
  .hero-cta {
    flex-direction: column;
  }
  
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

---

## 10. Technical Implementation

### 10.1 Tech Stack

```
RECOMMENDED STACK:
- HTML5 (semantic markup)
- CSS3 (custom properties, grid, flexbox, animations)
- Vanilla JavaScript (no framework needed for landing page)
- Optional: GSAP for advanced animations

ALTERNATIVE (if using framework):
- Next.js 14+ with App Router
- Tailwind CSS
- Framer Motion for animations

HOSTING:
- Vercel (recommended)
- Netlify
- Cloudflare Pages
```

### 10.2 File Structure

```
website/
├── index.html
├── css/
│   ├── reset.css
│   ├── variables.css
│   ├── components/
│   │   ├── window.css
│   │   ├── taskbar.css
│   │   ├── icons.css
│   │   ├── chat.css
│   │   └── buttons.css
│   ├── sections/
│   │   ├── hero.css
│   │   ├── features.css
│   │   ├── demo.css
│   │   └── cta.css
│   ├── utilities.css
│   └── responsive.css
├── js/
│   ├── main.js
│   ├── draggable.js
│   ├── chat-demo.js
│   ├── scroll-animations.js
│   └── taskbar.js
├── images/
│   ├── hero-bg.png
│   ├── document-scan.png
│   ├── dashboard.png
│   ├── icons/
│   │   ├── acta.png
│   │   ├── sat.png
│   │   └── ...
│   └── ...
├── videos/
│   ├── hero-loop.mp4
│   └── ...
└── fonts/
    └── ... (if self-hosting)
```

### 10.3 Performance Requirements

```
TARGETS:
- Lighthouse Performance: 90+
- First Contentful Paint: < 1.5s
- Largest Contentful Paint: < 2.5s
- Total Blocking Time: < 200ms
- Cumulative Layout Shift: < 0.1

OPTIMIZATION CHECKLIST:
□ Compress all images (WebP format preferred)
□ Lazy load images below the fold
□ Preload hero image and critical fonts
□ Minify CSS and JS
□ Use CSS containment for windows
□ Defer non-critical JS
□ Use video poster images
□ Implement proper caching headers
```

### 10.4 SEO Requirements

```html
<!-- Essential Meta Tags -->
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MexKYC - KYC Inteligente para México | Habla con tus Datos</title>
<meta name="description" content="La primera solución de KYC en México que te permite conversar con los datos de tus clientes. Extracción automática de Acta Constitutiva, SAT, INE y más.">
<meta name="keywords" content="KYC México, verificación de identidad, Acta Constitutiva, SAT, INE, fintech México, compliance, AML">
<meta name="author" content="MexKYC">
<link rel="canonical" href="https://mexkyc.com/">

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://mexkyc.com/">
<meta property="og:title" content="MexKYC - Conoce a tus clientes. Conversa con sus datos.">
<meta property="og:description" content="Primera solución KYC conversacional en México. Extracción automática de documentos con IA.">
<meta property="og:image" content="https://mexkyc.com/images/og-image.png">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="MexKYC - KYC Inteligente para México">
<meta name="twitter:description" content="Conversa con los datos de tus clientes. Extracción automática de documentos mexicanos.">
<meta name="twitter:image" content="https://mexkyc.com/images/twitter-card.png">

<!-- Structured Data -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "MexKYC",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "description": "AI-powered KYC document extraction for Mexican businesses",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "MXN"
  }
}
</script>
```

---

## 11. Asset Checklist

### 11.1 Images to Generate (Nano Banana Pro)

```
□ hero-background.png (16:9, 1920x1080)
□ document-scan.png (16:9, 1920x1080)
□ chat-interface.png (4:3, 1200x900)
□ dashboard-preview.png (16:9, 1920x1080)
□ mexico-network.png (16:9, 1920x1080)
□ security-badge.png (1:1, 512x512)
□ before-after.png (16:9, 1920x1080)
□ icon-acta.png (1:1, 128x128)
□ icon-sat.png (1:1, 128x128)
□ icon-ine.png (1:1, 128x128)
□ icon-fm2.png (1:1, 128x128)
□ icon-cfe.png (1:1, 128x128)
□ icon-telmex.png (1:1, 128x128)
□ icon-bank.png (1:1, 128x128)
□ icon-passport.png (1:1, 128x128)
□ og-image.png (1200x630)
□ twitter-card.png (1200x600)
□ favicon.ico (multiple sizes)
```

### 11.2 Videos to Generate (Nano Banana Pro)

```
□ hero-loop.mp4 (5s, 1080p, seamless loop)
□ document-scan.mp4 (4s, 1080p)
□ chat-demo.mp4 (6s, 1080p)
□ data-transform.mp4 (5s, 1080p)
□ logo-reveal.mp4 (3s, 1080p)
```

### 11.3 Development Checklist

```
PHASE 1: Setup
□ Create project structure
□ Set up CSS variables and reset
□ Import fonts

PHASE 2: Components
□ Build Window component
□ Build Taskbar component
□ Build Desktop Icon component
□ Build Chat component
□ Build Button components

PHASE 3: Sections
□ Build Hero section
□ Build Features section
□ Build Chat Demo section
□ Build Documents section
□ Build Video Demo section
□ Build CTA section
□ Build Footer

PHASE 4: Interactions
□ Implement window dragging
□ Implement chat demo
□ Implement scroll animations
□ Implement taskbar navigation
□ Implement real-time clock

PHASE 5: Assets
□ Generate all images with Nano Banana
□ Generate all videos with Nano Banana
□ Optimize and compress assets
□ Create favicon set

PHASE 6: Polish
□ Responsive testing
□ Cross-browser testing
□ Performance optimization
□ SEO implementation
□ Accessibility audit

PHASE 7: Launch
□ Deploy to hosting
□ Set up analytics
□ Test lead capture form
□ Final QA
```

---

## 12. Summary

This specification defines a **Hybrid OS** landing page that:

1. **Stands Out**: Windows-style interface is memorable and unique
2. **Demonstrates Product**: Every section is an interactive demo
3. **Converts Visitors**: Clear value proposition and lead capture
4. **Builds Trust**: Professional design with fintech aesthetic
5. **Is Buildable**: Complete specs for implementation

**Key Differentiators:**
- First KYC solution with conversational interface
- Specifically designed for Mexican documents
- Interactive OS metaphor = memorable experience
- Dark mode glassmorphism = premium feel

**Next Steps for Agent 2.0:**
1. Generate all assets using Nano Banana Pro prompts
2. Build HTML/CSS structure following component specs
3. Implement JavaScript interactions
4. Test and optimize
5. Deploy

---

*Document Version: 1.0*
*Created: November 2025*
*For: MexKYC Landing Page Development*

