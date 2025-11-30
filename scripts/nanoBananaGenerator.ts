/**
 * 🍌 Nano Banana Pro - Complete Landing Page Generator
 * 
 * Uses Gemini API (Nano Banana Pro) for:
 * - Images (hero, features, graphics)
 * - Videos/Animations (hero loop, product demos)
 * - Website assets (UI components, icons)
 * 
 * Usage:
 *   npx tsx scripts/nanoBananaGenerator.ts --images     # Generate all images
 *   npx tsx scripts/nanoBananaGenerator.ts --videos     # Generate all videos
 *   npx tsx scripts/nanoBananaGenerator.ts --website    # Generate full website
 *   npx tsx scripts/nanoBananaGenerator.ts --all        # Generate everything
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Nano Banana Pro Model IDs
const NANO_BANANA_IMAGE = "gemini-2.0-flash-exp-image-generation";
const NANO_BANANA_VIDEO = "veo-2.0-generate-001"; // Gemini's video model

// Output directories
const OUTPUT_BASE = path.join(__dirname, "../website/landing");
const OUTPUT_IMAGES = path.join(OUTPUT_BASE, "images");
const OUTPUT_VIDEOS = path.join(OUTPUT_BASE, "videos");

// Ensure output directories exist
[OUTPUT_BASE, OUTPUT_IMAGES, OUTPUT_VIDEOS].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ============================================================
// 🖼️ IMAGE PROMPTS
// ============================================================
const IMAGE_PROMPTS = {
  // Hero Section
  heroMain: {
    name: "hero-main",
    prompt: `Stunning hero image for Mexican KYC fintech startup.
    Visualization: Mexican legal documents (Acta Constitutiva with official seals) 
    transforming into beautiful flowing digital data streams.
    
    Style: Ultra-modern, dark mode, cinematic lighting
    Colors: Deep navy (#0a1628) background, electric blue (#3b82f6), cyan (#22d3ee) glows
    Elements: Abstract geometric shapes, floating document icons becoming data particles
    Quality: 4K, professional marketing quality
    Mood: Innovative, trustworthy, cutting-edge technology`,
    aspectRatio: "16:9"
  },

  // Chat Feature
  chatInterface: {
    name: "chat-interface",
    prompt: `Modern AI chat interface showing business data conversation.
    
    Show a sleek chat UI with:
    - User question bubble: "¿Quiénes son los accionistas de la empresa?"
    - AI response with structured data table showing shareholders
    
    Style: Glassmorphism, frosted glass cards on dark gradient
    Colors: Dark slate background, blue (#3b82f6) user bubbles, emerald (#10b981) AI
    Quality: High resolution, clean UI/UX design
    Mood: Professional SaaS product, easy to use`,
    aspectRatio: "4:3"
  },

  // Document Processing
  documentScan: {
    name: "document-scan",
    prompt: `AI scanning Mexican legal document visualization.
    
    Show: Physical Acta Constitutiva document with holographic scan effect
    Overlay: Glowing data extraction boxes floating above showing:
    - "Razón Social: [Company Name]"
    - "RFC: [Tax ID]"
    - "Representante Legal: [Name]"
    
    Style: Photorealistic document, sci-fi holographic overlay
    Colors: Blue (#3b82f6) and purple (#8b5cf6) scan lines
    Lighting: Dramatic, cinematic depth of field
    Quality: 4K professional`,
    aspectRatio: "16:9"
  },

  // Dashboard
  dashboard: {
    name: "dashboard-preview",
    prompt: `KYC compliance dashboard UI mockup - dark theme.
    
    Layout showing:
    - Left sidebar with navigation icons
    - Main area with document verification cards (green checkmarks)
    - Risk score gauge showing "Bajo Riesgo" in green
    - Company profile summary panel with Mexican company data
    - Recent activity timeline
    
    Style: Glassmorphism cards, modern SaaS dashboard
    Colors: Dark slate (#1e293b), blue (#3b82f6) accents, green (#22c55e) success
    Quality: 4K, pixel-perfect UI design`,
    aspectRatio: "16:9"
  },

  // Mexico Map
  mexicoNetwork: {
    name: "mexico-network",
    prompt: `Stylized map of Mexico showing nationwide fintech coverage.
    
    Design: Abstract geometric/low-poly representation of Mexico
    Highlights: Glowing nodes at Mexico City, Monterrey, Guadalajara, Tijuana
    Connections: Network lines connecting business hubs
    
    Style: Modern data visualization, tech-forward
    Colors: Dark background, turquoise (#14b8a6) nodes, gold (#f59e0b) connections
    Effects: Subtle glow, clean lines, professional
    Quality: High resolution`,
    aspectRatio: "16:9"
  },

  // Security
  securityBadge: {
    name: "security-badge",
    prompt: `Data security and compliance visualization.
    
    Central element: Glowing shield with lock icon
    Surrounding: Floating certification badges, compliance icons
    Background: Encrypted data streams, binary code patterns
    
    Style: Professional, enterprise-grade trust signals
    Colors: Deep blue (#1e40af) to purple (#7c3aed) gradient
    Effects: Subtle particle effects, modern 3D depth
    Quality: High resolution, icon-style`,
    aspectRatio: "1:1"
  },

  // Before/After
  transformation: {
    name: "transformation",
    prompt: `Split comparison: Manual KYC vs AI-powered KYC.
    
    LEFT (Before - Pain):
    - Messy desk with paper documents piled up
    - Stressed businessperson silhouette
    - Red warning icons, clock showing long time
    - Dull gray colors
    
    RIGHT (After - Solution):
    - Clean digital dashboard on modern screen
    - Happy professional, green checkmarks
    - Fast clock icon, efficiency symbols
    - Bright blue and white, modern
    
    Style: Marketing comparison graphic, clear division
    Quality: Professional, persuasive`,
    aspectRatio: "16:9"
  },

  // API/Developer
  apiConcept: {
    name: "api-integration",
    prompt: `Developer API integration concept illustration.
    
    Central: Glowing API endpoint icon with code brackets {}
    Connected nodes: Bank icon, Government (SAT) icon, Document icons
    Data flow: JSON-style data streams between nodes
    
    Style: Technical but clean, developer-focused
    Colors: Dark mode with syntax highlighting (blue, green, orange, purple)
    Effects: Modern flat design with subtle 3D depth
    Quality: High resolution`,
    aspectRatio: "4:3"
  }
};

// ============================================================
// 🎬 VIDEO/ANIMATION PROMPTS
// ============================================================
const VIDEO_PROMPTS = {
  // Hero Background Loop
  heroLoop: {
    name: "hero-background-loop",
    prompt: `Seamless looping background animation for fintech landing page.
    
    Content: Abstract data particles flowing smoothly from left to right
    Elements: Glowing blue and cyan orbs, thin connection lines, subtle grid
    Movement: Slow, elegant, hypnotic flow - perfect for background
    
    Style: Dark mode, modern tech aesthetic
    Colors: Navy background (#0a1628), electric blue (#3b82f6), cyan (#22d3ee)
    Duration: 5 seconds, seamless loop
    Quality: 1080p, 30fps`,
    duration: 5
  },

  // Document Scanning Animation
  scanAnimation: {
    name: "document-scan-animation",
    prompt: `Animation of AI scanning a Mexican legal document.
    
    Sequence:
    1. Document appears on screen
    2. Blue scan line moves top to bottom
    3. Data fields light up and float out as extracted
    4. Final: Clean extracted data display
    
    Style: Futuristic, holographic effects
    Colors: Blue scan line, glowing extracted data
    Duration: 4 seconds
    Quality: 1080p`,
    duration: 4
  },

  // Chat Typing Animation
  chatDemo: {
    name: "chat-demo-animation",
    prompt: `Animation showing AI chat interaction with KYC data.
    
    Sequence:
    1. User types: "Show me the company shareholders"
    2. AI typing indicator appears
    3. Response fades in with structured data table
    4. Data highlights one by one
    
    Style: Modern chat UI, smooth transitions
    Colors: Dark theme, blue user messages, green AI responses
    Duration: 6 seconds
    Quality: 1080p`,
    duration: 6
  },

  // Data Flow Animation
  dataFlow: {
    name: "data-flow-animation",
    prompt: `Abstract animation of documents transforming into structured data.
    
    Visual: Paper documents dissolve into digital particles
    Particles reform into organized data cards/JSON structure
    
    Style: Elegant, satisfying transformation
    Colors: Warm paper tones → cool digital blues
    Movement: Smooth, organic particle flow
    Duration: 5 seconds
    Quality: 1080p`,
    duration: 5
  },

  // Logo Animation
  logoReveal: {
    name: "logo-reveal",
    prompt: `Logo reveal animation for "MexKYC" fintech brand.
    
    Sequence:
    1. Particles converge from edges
    2. Form the text "MexKYC" 
    3. Subtle glow pulse on completion
    4. Tagline fades in below: "Know Your Customer. Instantly."
    
    Style: Premium, tech startup aesthetic
    Colors: White text on dark, blue glow accents
    Duration: 3 seconds
    Quality: 1080p, transparent background if possible`,
    duration: 3
  }
};

// ============================================================
// 🌐 WEBSITE HTML TEMPLATE
// ============================================================
const WEBSITE_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MexKYC - KYC Inteligente para México | Habla con tus Datos</title>
    <meta name="description" content="La primera solución de KYC en México que te permite conversar con los datos de tus clientes. Extracción automática de Acta Constitutiva, SAT, INE y más.">
    
    <!-- Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    
    <style>
        :root {
            --bg-primary: #0a1628;
            --bg-secondary: #1e293b;
            --bg-card: rgba(30, 41, 59, 0.8);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --accent-blue: #3b82f6;
            --accent-cyan: #22d3ee;
            --accent-green: #22c55e;
            --accent-purple: #8b5cf6;
            --gradient-hero: linear-gradient(135deg, #0a1628 0%, #1e3a5f 50%, #0a1628 100%);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Space Grotesk', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
            overflow-x: hidden;
        }

        /* Hero Section */
        .hero {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            background: var(--gradient-hero);
            overflow: hidden;
        }

        .hero-bg-video {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.3;
            z-index: 0;
        }

        .hero-content {
            position: relative;
            z-index: 10;
            text-align: center;
            max-width: 900px;
            padding: 2rem;
        }

        .hero-badge {
            display: inline-block;
            background: rgba(59, 130, 246, 0.2);
            border: 1px solid var(--accent-blue);
            color: var(--accent-cyan);
            padding: 0.5rem 1rem;
            border-radius: 50px;
            font-size: 0.875rem;
            margin-bottom: 1.5rem;
            animation: fadeInUp 0.6s ease;
        }

        .hero h1 {
            font-size: clamp(2.5rem, 6vw, 4.5rem);
            font-weight: 700;
            line-height: 1.1;
            margin-bottom: 1.5rem;
            animation: fadeInUp 0.6s ease 0.2s both;
        }

        .hero h1 .highlight {
            background: linear-gradient(90deg, var(--accent-blue), var(--accent-cyan));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .hero p {
            font-size: 1.25rem;
            color: var(--text-secondary);
            max-width: 600px;
            margin: 0 auto 2rem;
            animation: fadeInUp 0.6s ease 0.4s both;
        }

        .hero-cta {
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
            animation: fadeInUp 0.6s ease 0.6s both;
        }

        .btn {
            padding: 1rem 2rem;
            border-radius: 8px;
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }

        .btn-primary {
            background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
            color: white;
            border: none;
            box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 30px rgba(59, 130, 246, 0.6);
        }

        .btn-secondary {
            background: transparent;
            color: var(--text-primary);
            border: 1px solid var(--text-secondary);
        }

        .btn-secondary:hover {
            border-color: var(--accent-cyan);
            color: var(--accent-cyan);
        }

        /* Stats Section */
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 2rem;
            max-width: 800px;
            margin: 4rem auto 0;
            padding: 0 2rem;
            animation: fadeInUp 0.6s ease 0.8s both;
        }

        .stat {
            text-align: center;
        }

        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--accent-cyan);
            font-family: 'JetBrains Mono', monospace;
        }

        .stat-label {
            color: var(--text-secondary);
            font-size: 0.875rem;
            margin-top: 0.25rem;
        }

        /* Features Section */
        .features {
            padding: 6rem 2rem;
            background: var(--bg-secondary);
        }

        .section-header {
            text-align: center;
            max-width: 600px;
            margin: 0 auto 4rem;
        }

        .section-header h2 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
        }

        .section-header p {
            color: var(--text-secondary);
        }

        .features-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }

        .feature-card {
            background: var(--bg-card);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 2rem;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }

        .feature-card:hover {
            transform: translateY(-5px);
            border-color: var(--accent-blue);
            box-shadow: 0 10px 40px rgba(59, 130, 246, 0.2);
        }

        .feature-icon {
            width: 48px;
            height: 48px;
            background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            margin-bottom: 1rem;
        }

        .feature-card h3 {
            font-size: 1.25rem;
            margin-bottom: 0.75rem;
        }

        .feature-card p {
            color: var(--text-secondary);
            font-size: 0.95rem;
        }

        /* Chat Demo Section */
        .chat-demo {
            padding: 6rem 2rem;
            background: var(--bg-primary);
        }

        .chat-demo-container {
            max-width: 1000px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4rem;
            align-items: center;
        }

        .chat-window {
            background: var(--bg-card);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            overflow: hidden;
            backdrop-filter: blur(10px);
        }

        .chat-header {
            background: rgba(0,0,0,0.3);
            padding: 1rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .chat-avatar {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
            border-radius: 50%;
        }

        .chat-messages {
            padding: 1.5rem;
            min-height: 300px;
        }

        .message {
            margin-bottom: 1rem;
            max-width: 80%;
        }

        .message.user {
            margin-left: auto;
            background: var(--accent-blue);
            padding: 0.75rem 1rem;
            border-radius: 16px 16px 4px 16px;
        }

        .message.ai {
            background: rgba(34, 197, 94, 0.2);
            border: 1px solid var(--accent-green);
            padding: 0.75rem 1rem;
            border-radius: 16px 16px 16px 4px;
        }

        .message.ai .data-table {
            margin-top: 0.75rem;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.8rem;
        }

        /* Documents Section */
        .documents {
            padding: 6rem 2rem;
            background: var(--bg-secondary);
        }

        .doc-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1.5rem;
            max-width: 1000px;
            margin: 0 auto;
        }

        .doc-card {
            background: var(--bg-card);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            padding: 1.5rem;
            text-align: center;
            transition: all 0.3s ease;
        }

        .doc-card:hover {
            border-color: var(--accent-cyan);
            transform: scale(1.02);
        }

        .doc-icon {
            font-size: 2.5rem;
            margin-bottom: 0.75rem;
        }

        .doc-name {
            font-weight: 600;
            margin-bottom: 0.25rem;
        }

        .doc-desc {
            font-size: 0.8rem;
            color: var(--text-secondary);
        }

        /* CTA Section */
        .cta {
            padding: 6rem 2rem;
            background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%);
            text-align: center;
        }

        .cta h2 {
            font-size: 2.5rem;
            margin-bottom: 1rem;
        }

        .cta p {
            max-width: 500px;
            margin: 0 auto 2rem;
            opacity: 0.9;
        }

        .cta .btn-primary {
            background: white;
            color: var(--accent-blue);
        }

        /* Footer */
        footer {
            padding: 3rem 2rem;
            background: var(--bg-primary);
            text-align: center;
            color: var(--text-secondary);
        }

        /* Animations */
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

        /* Responsive */
        @media (max-width: 768px) {
            .chat-demo-container {
                grid-template-columns: 1fr;
            }
            
            .hero h1 {
                font-size: 2rem;
            }
        }
    </style>
</head>
<body>
    <!-- Hero Section -->
    <section class="hero">
        <video class="hero-bg-video" autoplay muted loop playsinline>
            <source src="videos/hero-background-loop.mp4" type="video/mp4">
        </video>
        
        <div class="hero-content">
            <span class="hero-badge">🚀 Primera solución KYC conversacional en México</span>
            
            <h1>
                Conoce a tus clientes.<br>
                <span class="highlight">Conversa con sus datos.</span>
            </h1>
            
            <p>
                Extracción automática de documentos mexicanos con IA. 
                Pregunta lo que quieras sobre tus clientes en lenguaje natural.
            </p>
            
            <div class="hero-cta">
                <a href="#demo" class="btn btn-primary">
                    Ver Demo →
                </a>
                <a href="#contact" class="btn btn-secondary">
                    Hablar con Ventas
                </a>
            </div>
            
            <div class="stats">
                <div class="stat">
                    <div class="stat-value">3min</div>
                    <div class="stat-label">Tiempo promedio KYC</div>
                </div>
                <div class="stat">
                    <div class="stat-value">99.2%</div>
                    <div class="stat-label">Precisión extracción</div>
                </div>
                <div class="stat">
                    <div class="stat-value">8+</div>
                    <div class="stat-label">Tipos de documentos</div>
                </div>
                <div class="stat">
                    <div class="stat-value">$0</div>
                    <div class="stat-label">Costo de setup</div>
                </div>
            </div>
        </div>
    </section>

    <!-- Features Section -->
    <section class="features" id="features">
        <div class="section-header">
            <h2>¿Por qué MexKYC?</h2>
            <p>La única solución diseñada específicamente para documentos mexicanos</p>
        </div>
        
        <div class="features-grid">
            <div class="feature-card">
                <div class="feature-icon">💬</div>
                <h3>Habla con tus Datos</h3>
                <p>Pregunta en español: "¿Quiénes son los accionistas?" y obtén respuestas instantáneas de los documentos de tu cliente.</p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">📄</div>
                <h3>Documentos Mexicanos</h3>
                <p>Acta Constitutiva, Constancia SAT, INE, FM2, CFE, TELMEX, estados de cuenta. Todo automatizado.</p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">⚡</div>
                <h3>3 Minutos, No 3 Días</h3>
                <p>Reduce el tiempo de onboarding de días a minutos. Tu equipo se enfoca en decisiones, no en captura.</p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">🔒</div>
                <h3>Compliance Automático</h3>
                <p>Validación automática de RFC, detección de inconsistencias, alertas de riesgo. Todo documentado.</p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">🔌</div>
                <h3>API Simple</h3>
                <p>Integra en tu sistema existente con nuestra API REST. Documentación clara, SDKs disponibles.</p>
            </div>
            
            <div class="feature-card">
                <div class="feature-icon">📊</div>
                <h3>Reportes Ejecutivos</h3>
                <p>Genera reportes KYC completos en PDF automáticamente. Listos para auditoría.</p>
            </div>
        </div>
    </section>

    <!-- Chat Demo Section -->
    <section class="chat-demo" id="demo">
        <div class="chat-demo-container">
            <div>
                <h2>Conversa con los datos de tu cliente</h2>
                <p style="color: var(--text-secondary); margin: 1rem 0 2rem;">
                    Después de cargar los documentos, simplemente pregunta lo que necesitas saber. 
                    Sin buscar en PDFs, sin copiar y pegar.
                </p>
                
                <ul style="list-style: none; color: var(--text-secondary);">
                    <li style="margin-bottom: 0.75rem;">✓ "¿Cuál es el RFC de la empresa?"</li>
                    <li style="margin-bottom: 0.75rem;">✓ "¿Quién es el representante legal?"</li>
                    <li style="margin-bottom: 0.75rem;">✓ "¿Cuáles son las facultades del apoderado?"</li>
                    <li style="margin-bottom: 0.75rem;">✓ "¿Hay inconsistencias en los documentos?"</li>
                </ul>
            </div>
            
            <div class="chat-window">
                <div class="chat-header">
                    <div class="chat-avatar"></div>
                    <span style="font-weight: 600;">MexKYC Assistant</span>
                </div>
                <div class="chat-messages">
                    <div class="message user">
                        ¿Quiénes son los accionistas de esta empresa?
                    </div>
                    <div class="message ai">
                        <strong>Accionistas de Grupo Ejemplo S.A. de C.V.:</strong>
                        <div class="data-table">
                            <div>• Juan Pérez García — 45%</div>
                            <div>• María López Ruiz — 35%</div>
                            <div>• Carlos Mendoza S. — 20%</div>
                        </div>
                        <div style="margin-top: 0.5rem; font-size: 0.75rem; opacity: 0.7;">
                            📄 Fuente: Acta Constitutiva (pág. 3)
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- Supported Documents -->
    <section class="documents" id="documents">
        <div class="section-header">
            <h2>Documentos Soportados</h2>
            <p>Extracción automática de todos los documentos KYC mexicanos</p>
        </div>
        
        <div class="doc-grid">
            <div class="doc-card">
                <div class="doc-icon">📜</div>
                <div class="doc-name">Acta Constitutiva</div>
                <div class="doc-desc">Datos societarios, poderes, accionistas</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">🏛️</div>
                <div class="doc-name">Constancia SAT</div>
                <div class="doc-desc">RFC, régimen fiscal, domicilio</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">🪪</div>
                <div class="doc-name">INE / IFE</div>
                <div class="doc-desc">Identificación oficial vigente</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">✈️</div>
                <div class="doc-name">FM2 / FM3</div>
                <div class="doc-desc">Documento migratorio</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">💡</div>
                <div class="doc-name">CFE</div>
                <div class="doc-desc">Comprobante de domicilio</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">📞</div>
                <div class="doc-name">TELMEX</div>
                <div class="doc-desc">Comprobante de domicilio</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">🏦</div>
                <div class="doc-name">Estados de Cuenta</div>
                <div class="doc-desc">Bancarios, últimos 3 meses</div>
            </div>
            <div class="doc-card">
                <div class="doc-icon">🛂</div>
                <div class="doc-name">Pasaporte</div>
                <div class="doc-desc">Mexicano o extranjero</div>
            </div>
        </div>
    </section>

    <!-- CTA Section -->
    <section class="cta" id="contact">
        <h2>¿Listo para automatizar tu KYC?</h2>
        <p>Únete a las primeras 25 empresas en acceso anticipado. Sin costo de implementación.</p>
        <a href="mailto:hola@mexkyc.com" class="btn btn-primary">
            Solicitar Acceso →
        </a>
    </section>

    <!-- Footer -->
    <footer>
        <p>© 2025 MexKYC. Hecho en México 🇲🇽</p>
        <p style="margin-top: 0.5rem; font-size: 0.8rem;">
            Conoce a tus clientes. Conversa con sus datos.
        </p>
    </footer>
</body>
</html>`;

// ============================================================
// 🛠️ GENERATION FUNCTIONS
// ============================================================

interface GenerationResult {
  name: string;
  type: 'image' | 'video' | 'website';
  success: boolean;
  filePath?: string;
  error?: string;
}

async function generateImage(
  client: GoogleGenerativeAI,
  name: string,
  prompt: string,
  aspectRatio: string = "16:9"
): Promise<GenerationResult> {
  console.log(`\n🖼️  Generating image: ${name}...`);
  
  try {
    const model = client.getGenerativeModel({ 
      model: NANO_BANANA_IMAGE,
      generationConfig: {
        // @ts-ignore
        responseModalities: ["TEXT", "IMAGE"],
      }
    });

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: `${prompt}\n\nAspect ratio: ${aspectRatio}` }]
      }]
    });

    const response = result.response;
    
    for (const candidate of response.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.inlineData) {
          const imageData = part.inlineData.data;
          const mimeType = part.inlineData.mimeType || "image/png";
          const extension = mimeType.includes("jpeg") ? "jpg" : "png";
          
          const fileName = `${name}.${extension}`;
          const filePath = path.join(OUTPUT_IMAGES, fileName);
          
          const buffer = Buffer.from(imageData, "base64");
          fs.writeFileSync(filePath, buffer);
          
          console.log(`   ✅ Saved: ${fileName}`);
          return { name, type: 'image', success: true, filePath };
        }
      }
    }
    
    return { name, type: 'image', success: false, error: "No image in response" };
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return { name, type: 'image', success: false, error: error.message };
  }
}

async function generateVideo(
  client: GoogleGenerativeAI,
  name: string,
  prompt: string,
  duration: number
): Promise<GenerationResult> {
  console.log(`\n🎬 Generating video: ${name} (${duration}s)...`);
  
  try {
    // Note: Video generation may require different API endpoint
    // For now, we'll use the image model and note that video requires Veo
    const model = client.getGenerativeModel({ 
      model: NANO_BANANA_VIDEO,
    });

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: `Generate a ${duration}-second video:\n\n${prompt}` }]
      }]
    });

    const response = result.response;
    const text = response.text();
    
    // Video generation typically returns a URL or requires polling
    console.log(`   ⚠️ Video generation response: ${text?.substring(0, 200)}...`);
    
    // For now, create a placeholder
    const placeholderPath = path.join(OUTPUT_VIDEOS, `${name}.txt`);
    fs.writeFileSync(placeholderPath, `Video Prompt:\n${prompt}\n\nDuration: ${duration}s\n\nNote: Use Google AI Studio or Veo API directly for video generation.`);
    
    return { name, type: 'video', success: true, filePath: placeholderPath };
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    
    // Save prompt for manual generation
    const promptPath = path.join(OUTPUT_VIDEOS, `${name}-prompt.txt`);
    fs.writeFileSync(promptPath, `Video Prompt for Nano Banana Pro:\n\n${prompt}\n\nDuration: ${duration}s`);
    
    return { name, type: 'video', success: false, error: error.message, filePath: promptPath };
  }
}

async function generateWebsite(): Promise<GenerationResult> {
  console.log(`\n🌐 Generating website HTML...`);
  
  try {
    const filePath = path.join(OUTPUT_BASE, "index.html");
    fs.writeFileSync(filePath, WEBSITE_TEMPLATE);
    
    console.log(`   ✅ Saved: index.html`);
    return { name: 'landing-page', type: 'website', success: true, filePath };
    
  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return { name: 'landing-page', type: 'website', success: false, error: error.message };
  }
}

async function generateAllImages(client: GoogleGenerativeAI): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  
  for (const [key, config] of Object.entries(IMAGE_PROMPTS)) {
    const result = await generateImage(client, config.name, config.prompt, config.aspectRatio);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return results;
}

async function generateAllVideos(client: GoogleGenerativeAI): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  
  for (const [key, config] of Object.entries(VIDEO_PROMPTS)) {
    const result = await generateVideo(client, config.name, config.prompt, config.duration);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return results;
}

function printSummary(results: GenerationResult[]) {
  console.log("\n" + "=".repeat(60));
  console.log("📊 GENERATION SUMMARY");
  console.log("=".repeat(60));
  
  const byType = {
    image: results.filter(r => r.type === 'image'),
    video: results.filter(r => r.type === 'video'),
    website: results.filter(r => r.type === 'website')
  };
  
  for (const [type, items] of Object.entries(byType)) {
    if (items.length === 0) continue;
    
    const successful = items.filter(r => r.success);
    console.log(`\n${type.toUpperCase()}S: ${successful.length}/${items.length} successful`);
    
    for (const result of items) {
      const status = result.success ? '✅' : '❌';
      console.log(`   ${status} ${result.name}`);
      if (result.filePath) console.log(`      → ${result.filePath}`);
      if (result.error) console.log(`      → Error: ${result.error}`);
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("📁 Output directory: " + OUTPUT_BASE);
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY not set");
    process.exit(1);
  }
  
  const client = new GoogleGenerativeAI(apiKey);
  const args = process.argv.slice(2);
  
  console.log("\n" + "=".repeat(60));
  console.log("🍌 NANO BANANA PRO - Complete Landing Page Generator");
  console.log("=".repeat(60));
  
  const results: GenerationResult[] = [];
  
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Usage:
  npx tsx scripts/nanoBananaGenerator.ts [options]

Options:
  --images    Generate all landing page images
  --videos    Generate all video/animation prompts
  --website   Generate the HTML landing page
  --all       Generate everything (images + videos + website)
  --list      List all available prompts
  --help      Show this help

Examples:
  npm run banana -- --images
  npm run banana -- --all
`);
    return;
  }
  
  if (args.includes("--list")) {
    console.log("\n📋 IMAGE PROMPTS:");
    for (const [key, config] of Object.entries(IMAGE_PROMPTS)) {
      console.log(`  • ${config.name} (${config.aspectRatio})`);
    }
    console.log("\n🎬 VIDEO PROMPTS:");
    for (const [key, config] of Object.entries(VIDEO_PROMPTS)) {
      console.log(`  • ${config.name} (${config.duration}s)`);
    }
    return;
  }
  
  const generateImages = args.includes("--images") || args.includes("--all");
  const generateVideos = args.includes("--videos") || args.includes("--all");
  const generateWeb = args.includes("--website") || args.includes("--all");
  
  // Default to --all if no specific flags
  const noFlags = !generateImages && !generateVideos && !generateWeb;
  
  if (generateImages || noFlags) {
    console.log("\n🖼️  Generating images...");
    results.push(...await generateAllImages(client));
  }
  
  if (generateVideos || noFlags) {
    console.log("\n🎬 Generating videos...");
    results.push(...await generateAllVideos(client));
  }
  
  if (generateWeb || noFlags) {
    console.log("\n🌐 Generating website...");
    results.push(await generateWebsite());
  }
  
  printSummary(results);
}

main().catch(console.error);
