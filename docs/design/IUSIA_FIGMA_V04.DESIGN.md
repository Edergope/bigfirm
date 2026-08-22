# DESIGN.md -- IUSIA — Product Design v0.4

<!-- extraction-meta
source: Figma file "IUSIA — Product Design v0.4"
scope: 1 page(s)
date: 2026-08-22
nodes-scanned: 73
generator: figma-cli extract
-->

## 1. Identity

**In one line:** A design system using Inter with 10 unique colors extracted directly from Figma.

**Signature Techniques:**
- Consistent auto-layout spacing system
- Component library with 0 variants across 0 component sets

## 2. Structure

High-level composition. Each entry: frame name, type, dimensions, auto-layout.

### Page: 01 · Matter Workspace

_9 top-level frame(s)_

- **StatusChip** · `COMPONENT` · 76×24 · horizontal row, gap 6px, padding 4/10/4/10px · 2 children
  - **Dot** · `ELLIPSE` · 6×6
  - **Label** · `TEXT` · 44×16 · “Neutral”
- **Button/Ghost** · `COMPONENT` · 66×20 · horizontal row, gap 4px, padding 2/0/2/0px · 2 children
  - **Label** · `TEXT` · 49×16 · “Ver más”
  - **icon/chevron-right** · `FRAME` · 13×13 · 1 children
    - **Vector** · `VECTOR` · 3×7
- **NavItem** · `COMPONENT` · 212×40 · horizontal row, gap 10px, padding 9/12/9/12px · 2 children
  - **icon** · `FRAME` · 17×17 · 2 children
    - **Vector** · `VECTOR` · 4×6
    - **Vector** · `VECTOR` · 13×13
  - **Label** · `TEXT` · 161×22 · “Inicio”
- **MatterTab** · `COMPONENT` · 33×44 · vertical stack, padding 0/2/0/2px · 2 children
  - **LabelWrap** · `FRAME` · 29×42 · horizontal row, padding 10/2/10/2px · 1 children
    - **Label** · `TEXT` · 25×22 · “Tab”
  - **Indicator** · `RECTANGLE` · 29×2
- **DocumentRow** · `COMPONENT` · 400×66 · horizontal row, gap 12px, padding 12/0/12/0px · 3 children
  - **icon** · `FRAME` · 17×17 · 5 children
    - **Vector** · `VECTOR` · 11×14
    - **Vector** · `VECTOR` · 4×4
    - **Vector** · `VECTOR` · 1×0
    - **Vector** · `VECTOR` · 6×0 · ×2
  - **TextCol** · `FRAME` · 283×42 · vertical stack, gap 2px · 2 children
    - **Name** · `TEXT` · 283×22 · “Documento”
    - **Meta** · `TEXT` · 283×18 · “Clasificación · Fecha”
  - **Status** · `INSTANCE` · 76×24 · horizontal row, gap 6px, padding 4/10/4/10px · instance of Status
- **TimelineItem** · `COMPONENT` · 400×70 · horizontal row, gap 12px, padding 10/0/10/0px · 2 children
  - **Date** · `TEXT` · 52×18 · “01 ene”
  - **Body** · `FRAME` · 336×50 · vertical stack, gap 4px · 2 children
    - **Label** · `TEXT` · 336×22 · “Evento del expediente”
    - **Tag** · `INSTANCE` · 76×24 · horizontal row, gap 6px, padding 4/10/4/10px · instance of Tag
- **AttentionItem** · `COMPONENT` · 360×92 · horizontal row, gap 10px, padding 12/0/12/0px · 2 children
  - **IconWrap** · `FRAME` · 22×22 · 1 children
    - **icon** · `FRAME` · 18×18 · 3 children
      - **Vector** · `VECTOR` · 15×14
      - **Vector** · `VECTOR` · 0×3
      - **Vector** · `VECTOR` · 0×0
  - **Body** · `FRAME` · 328×68 · vertical stack, gap 4px · 3 children
    - **Title** · `TEXT` · 328×22 · “Título de atención”
    - **Description** · `TEXT` · 328×18 · “Descripción breve del requerimiento.”
    - **Action** · `INSTANCE` · 66×20 · horizontal row, gap 4px, padding 2/0/2/0px · instance of Action
- **IntelligenceInsight** · `COMPONENT` · 360×199 · vertical stack, gap 10px, padding 18/20/18/20px · 5 children
  - **BadgeRow** · `FRAME` · 129×18 · horizontal row, gap 6px · 2 children
    - **icon** · `FRAME` · 14×14 · 4 children
      - **Vector** · `VECTOR` · 12×12
      - **Vector** · `VECTOR` · 0×2
      - **Vector** · `VECTOR` · 2×0
      - **Vector** · `VECTOR` · 2×2
    - **Badge** · `TEXT` · 109×18 · “IUSIA DETECTÓ”
  - **Finding** · `TEXT` · 320×23 · “Hallazgo detectado por IUSIA.”
  - **Reason** · `TEXT` · 320×44 · “Explicación de por qué esto importa para el expediente.”
  - **Source** · `TEXT` · 320×18 · “Fuente: —”
  - **Action** · `INSTANCE` · 66×20 · horizontal row, gap 4px, padding 2/0/2/0px · instance of Action
- **Matter Workspace · Resumen · Desktop** · `FRAME` · 1440×900 · horizontal row · 2 children
  - **Rail** · `FRAME` · 176×900 · vertical stack
  - **MainColumn** · `FRAME` · 1264×900 · vertical stack · 2 children
    - **Topbar** · `FRAME` · 1264×64 · horizontal row
    - **Content** · `FRAME` · 1264×10 · vertical stack, gap 24px, padding 28/40/40/40px · 3 children
      - **MatterHeader** · `FRAME` · 1184×10 · vertical stack
      - **TabsRow** · `FRAME` · 1184×10 · vertical stack
      - **BodySplit** · `FRAME` · 1184×10 · vertical stack

## 3. Color

### Palette

| Token | Hex | Usage count |
|---|---|---|
| text-secondary | `#68707b` | 14 |
| border | `#a7adb5` | 5 |
| accent | `#0f798f` | 5 |
| accent-alt | `#1f2937` | 4 |
| accent-3 | `#d97706` | 3 |
| accent-4 | `#2563eb` | 2 |
| accent-5 | `#0b1d3a` | 2 |
| background | `#ffffff` | 2 |
| accent-6 | `#22c7e8` | 1 |
| background-alt | `#f7f8fa` | 1 |

## 4. Variables

Real Figma variable collections — the authoritative tokens (names, modes, values). These come straight from the file, unlike the sampled palette above. `figma-cli import` can recreate them as variables.

### Collection: IUSIA  ·  28 variables  ·  modes: Value

| Variable | Type | Value |
|---|---|---|
| color/navy | COLOR | `#0b1d3a` |
| color/carbon | COLOR | `#1f2937` |
| color/action | COLOR | `#2563eb` |
| color/intel | COLOR | `#22c7e8` |
| color/intelText | COLOR | `#0f798f` |
| color/gold | COLOR | `#c9a24b` |
| color/goldText | COLOR | `#8b6d2a` |
| color/mist | COLOR | `#a7adb5` |
| color/mistText | COLOR | `#68707b` |
| color/mistStrong | COLOR | `#89919b` |
| color/surface | COLOR | `#f7f8fa` |
| color/paper | COLOR | `#ffffff` |
| color/success | COLOR | `#16a34a` |
| color/successText | COLOR | `#11803a` |
| color/warning | COLOR | `#d97706` |
| color/warningText | COLOR | `#a65b05` |
| color/critical | COLOR | `#dc2626` |
| color/info | COLOR | `#2563eb` |
| space/1 | FLOAT | 8 |
| space/2 | FLOAT | 12 |
| space/3 | FLOAT | 16 |
| space/4 | FLOAT | 24 |
| space/5 | FLOAT | 32 |
| space/6 | FLOAT | 48 |
| radius/sm | FLOAT | 8 |
| radius/md | FLOAT | 10 |
| radius/card | FLOAT | 14 |
| radius/pill | FLOAT | 9999 |

## 5. Typography

### Fonts

- Inter

### Scale

| Token | Family | Size | Weight | Line height |
|---|---|---|---|---|
| body-lg | Inter | 17px | 600 | 23px |
| body | Inter | 15px | 500 | 22px |
| body-2 | Inter | 15px | 400 | 22px |
| body-3 | Inter | 14px | 400 | 22px |
| body-4 | Inter | 13px | 500 | 18px |
| body-5 | Inter | 13px | 600 | 18px |
| body-sm | Inter | 12.5px | 500 | 16px |

## 6. Spacing & Layout

### Base Unit

2px

### Border Radius

| Token | Value |
|---|---|
| radius-sm | 10px |
| radius-md | 14px |
| radius-full | 9999px |

## 7. Depth & Motion

### Elevation

_no shadow effects found_

## 8. Components

_no component sets found_

## 9. States

State tokens should be derived from the base palette above. Recommended mappings:

| State | Treatment |
|-------|-----------|
| Hover | Lighten/darken accent by 10% |
| Focus | 2px ring using accent color with 30% opacity |
| Disabled | 40% opacity, no pointer events |
| Error | Use danger color for border and text |

## 10. Rules

### Do

- Use the 2px base unit for all spacing decisions
- Use `#0f798f` (accent) as the primary accent color
- Bind colors to the tokens below instead of hardcoding hex values

### Don't

- Introduce new colors without adding them to the palette
- Mix corner radii outside the radius scale

## 11. Extending this system

### How to reuse this DESIGN.md

Import into Figma with `figma-cli import <this file>` — colors, radii and typography become variables.

### When to add a new token vs reuse

Reuse the closest existing token; add a new one only when a new semantic role appears.

## 12. Machine-readable tokens

The block below is the canonical token map. It mirrors the tables above but is unambiguous and parseable.

```json design-tokens
{
  "$schema": "design-tokens.v1",
  "meta": {
    "source": "IUSIA — Product Design v0.4",
    "generated": "2026-08-22"
  },
  "color": {
    "text-secondary": "#68707b",
    "border": "#a7adb5",
    "accent": "#0f798f",
    "accent-alt": "#1f2937",
    "accent-3": "#d97706",
    "accent-4": "#2563eb",
    "accent-5": "#0b1d3a",
    "background": "#ffffff",
    "accent-6": "#22c7e8",
    "background-alt": "#f7f8fa"
  },
  "typography": {
    "body-lg": {
      "fontFamily": "Inter",
      "fontSize": 17,
      "fontWeight": 600,
      "lineHeight": 23
    },
    "body": {
      "fontFamily": "Inter",
      "fontSize": 15,
      "fontWeight": 500,
      "lineHeight": 22
    },
    "body-2": {
      "fontFamily": "Inter",
      "fontSize": 15,
      "fontWeight": 400,
      "lineHeight": 22
    },
    "body-3": {
      "fontFamily": "Inter",
      "fontSize": 14,
      "fontWeight": 400,
      "lineHeight": 22
    },
    "body-4": {
      "fontFamily": "Inter",
      "fontSize": 13,
      "fontWeight": 500,
      "lineHeight": 18
    },
    "body-5": {
      "fontFamily": "Inter",
      "fontSize": 13,
      "fontWeight": 600,
      "lineHeight": 18,
      "letterSpacing": 6
    },
    "body-sm": {
      "fontFamily": "Inter",
      "fontSize": 12.5,
      "fontWeight": 500,
      "lineHeight": 16
    }
  },
  "spacing": {
    "base-unit": 2
  },
  "radius": {
    "radius-sm": "10px",
    "radius-md": "14px",
    "radius-full": "9999px"
  },
  "shadow": {},
  "fonts": [
    "Inter"
  ],
  "variables": {
    "IUSIA": {
      "modes": [
        "Value"
      ],
      "variables": {
        "color/navy": {
          "type": "COLOR",
          "values": {
            "Value": "#0b1d3a"
          }
        },
        "color/carbon": {
          "type": "COLOR",
          "values": {
            "Value": "#1f2937"
          }
        },
        "color/action": {
          "type": "COLOR",
          "values": {
            "Value": "#2563eb"
          }
        },
        "color/intel": {
          "type": "COLOR",
          "values": {
            "Value": "#22c7e8"
          }
        },
        "color/intelText": {
          "type": "COLOR",
          "values": {
            "Value": "#0f798f"
          }
        },
        "color/gold": {
          "type": "COLOR",
          "values": {
            "Value": "#c9a24b"
          }
        },
        "color/goldText": {
          "type": "COLOR",
          "values": {
            "Value": "#8b6d2a"
          }
        },
        "color/mist": {
          "type": "COLOR",
          "values": {
            "Value": "#a7adb5"
          }
        },
        "color/mistText": {
          "type": "COLOR",
          "values": {
            "Value": "#68707b"
          }
        },
        "color/mistStrong": {
          "type": "COLOR",
          "values": {
            "Value": "#89919b"
          }
        },
        "color/surface": {
          "type": "COLOR",
          "values": {
            "Value": "#f7f8fa"
          }
        },
        "color/paper": {
          "type": "COLOR",
          "values": {
            "Value": "#ffffff"
          }
        },
        "color/success": {
          "type": "COLOR",
          "values": {
            "Value": "#16a34a"
          }
        },
        "color/successText": {
          "type": "COLOR",
          "values": {
            "Value": "#11803a"
          }
        },
        "color/warning": {
          "type": "COLOR",
          "values": {
            "Value": "#d97706"
          }
        },
        "color/warningText": {
          "type": "COLOR",
          "values": {
            "Value": "#a65b05"
          }
        },
        "color/critical": {
          "type": "COLOR",
          "values": {
            "Value": "#dc2626"
          }
        },
        "color/info": {
          "type": "COLOR",
          "values": {
            "Value": "#2563eb"
          }
        },
        "space/1": {
          "type": "FLOAT",
          "values": {
            "Value": 8
          }
        },
        "space/2": {
          "type": "FLOAT",
          "values": {
            "Value": 12
          }
        },
        "space/3": {
          "type": "FLOAT",
          "values": {
            "Value": 16
          }
        },
        "space/4": {
          "type": "FLOAT",
          "values": {
            "Value": 24
          }
        },
        "space/5": {
          "type": "FLOAT",
          "values": {
            "Value": 32
          }
        },
        "space/6": {
          "type": "FLOAT",
          "values": {
            "Value": 48
          }
        },
        "radius/sm": {
          "type": "FLOAT",
          "values": {
            "Value": 8
          }
        },
        "radius/md": {
          "type": "FLOAT",
          "values": {
            "Value": 10
          }
        },
        "radius/card": {
          "type": "FLOAT",
          "values": {
            "Value": 14
          }
        },
        "radius/pill": {
          "type": "FLOAT",
          "values": {
            "Value": 9999
          }
        }
      }
    }
  }
}
```
