---
name: ContaIA Enterprise Claro
colors:
  surface: '#f9f9ff'
  surface-dim: '#cedbf2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff3ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dde9ff'
  surface-container-highest: '#d7e3fb'
  on-surface: '#101c2d'
  on-surface-variant: '#45464d'
  inverse-surface: '#253143'
  inverse-on-surface: '#ebf1ff'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#785a00'
  on-secondary: '#ffffff'
  secondary-container: '#fdc73a'
  on-secondary-container: '#705400'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#001944'
  on-tertiary-container: '#5081e5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#ffdf9a'
  secondary-fixed-dim: '#f4bf31'
  on-secondary-fixed: '#251a00'
  on-secondary-fixed-variant: '#5a4300'
  tertiary-fixed: '#d9e2ff'
  tertiary-fixed-dim: '#b0c6ff'
  on-tertiary-fixed: '#001944'
  on-tertiary-fixed-variant: '#00429a'
  background: '#f9f9ff'
  on-background: '#101c2d'
  surface-variant: '#d7e3fb'
typography:
  headline-lg:
    fontFamily: Geist
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  title-md:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  title-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.02em
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  code-xs:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 1.75rem
---

## Brand & Style
The design system reflects institutional financial authority, regulatory precision, and automated intelligence for multi-tenant Brazilian accounting operations. It balances the austere stability expected by CFOs, auditors, and certified accountants (*contadores*) with the streamlined velocity of contemporary SaaS pioneers like Linear and Stripe.

The visual style is **Corporate / Modern High-Density**:
- **Aesthetic Tenets**: Monochromatic discipline, subtle borders over loud shadows, razor-sharp typography, and surgical use of data-density surfaces.
- **Emotional Response**: Absolute compliance safety, audit-grade reliability, and frictionless mastery over intricate tax engines (SPED, EFD-Reinf, NF-e/NFS-e, eSocial).
- **AI Integration Metaphor**: AI suggestions and automated reconciliations do not present as playful consumer assistants; they appear as calibrated, non-intrusive auditor notes, signaled by discreet gold accents and deterministic confidence ratings.

## Colors
The palette is engineered to endure extended sessions of data entry, ledger reconciliation, and fiscal discrepancy hunting without visual fatigue.

### Core Architectural Palette
- **Primary (`#0F172A`)**: Deep Slate/Navy. Governs high-priority actions, master headers, enterprise navigation frames, and primary typographic hierarchy.
- **Secondary / AI Precision (`#D6A40E`)**: Amber Gold. Applied intentionally to indicate machine learning automation, automated classification certainty, valid certificates (e-CNPJ A1/A3), and verified SEFAZ synchs.
- **Tertiary / Informational (`#1855B7`)**: Institutional Blue. Dedicated to neutral fiscal telemetry, Gov.br federated flows, documentation overlays, and system-level notices.
- **Neutrals**:
  - `Canvas / Background`: `#F8FAFC` (Slate 50)
  - `Card / Surface`: `#FFFFFF`
  - `Subtle / Surface Hover`: `#F1F5F9` (Slate 100)
  - `Border / Hairlines`: `#E2E8F0` (Slate 200)
  - `Muted Borders`: `#CBD5E1` (Slate 300)
  - `Muted Text / Labels`: `#64748B` (Slate 500)
  - `Body Text`: `#334155` (Slate 700)
  - `High Contrast Text`: `#0F172A` (Slate 900)

### Fiscal Status & Regulatory Traffic Light (Semáforo Fiscal)
- **Compliant / Zero Risk (`#10B981`)**: Reconciled entries, valid digital signatures, accepted SEFAZ manifests. Surface background: `#ECFDF5`. Border: `#A7F3D0`.
- **Warning / Due Date Risk / D-3 (`#F59E0B`)**: Pending municipal NFS-e validations, expiring tax obligations (DARF/DAS), impending compliance deadlines. Surface background: `#FFFBEB`. Border: `#FDE68A`.
- **Critical / Fine Imminent / SEFAZ Rejection (`#EF4444`)**: Inconsistencies in CFOP/CST, cancelled NF-e after deadline, missing certificate keys, tax calculation mismatch. Surface background: `#FEF2F2`. Border: `#FECACA`.
- **System Info (`#1855B7`)**: Scheduled background batch processing, batch NSU downloading. Surface background: `#EFF6FF`. Border: `#BFDBFE`.

## Typography
Typographic composition emphasizes tabular alignment, information density, and rapid character differentiation.

### Application Logic
- **Geist (Display & Page Headers)**: Employs modern geometric cuts and tight kerning to provide a contemporary, authoritative software posture on overview dashboards and analytical KPI modules.
- **Inter (Application UI & Ledger Data)**: Optimized for long-form data reading, dense data tables, modal dialogs, and nested multi-company selector hierarchies. Tabular figures (`tnum`) must be enforced across all monetary columns (BRL values), tax base amounts, and dates.
- **JetBrains Mono (Fiscal Codes & Cryptographic Strings)**: Mandatory for all 44-digit NF-e Access Keys (*Chave de Acesso*), CNPJ/CPF masks, NSU strings, SHA-256 digital signature hashes, and fiscal taxonomy classifications (CFOP, NCM, CEST, CST, CNAE). Monospaced rendering ensures immediate optical alignment and error spotting across adjacent records.

## Layout & Spacing
The layout model employs a high-density, 12-column adaptive grid designed primarily for expansive desktop displays (1440px+ and 1920px audit workstations), with fluid scaling for mobile administrative approvals.

### Grid & Breakpoints
- **Mobile (`< 768px`)**: Single column fluid stack. Outer margin is `1rem`. Complex fiscal tables collapse into responsive cards prioritizing status badges, legal due dates, and action menus.
- **Tablet (`768px - 1023px`)**: Collapsible persistent icon rail navigation (`64px`), 8-column layout, `1rem` gutters, and horizontal scrolling for wide financial ledgers with sticky headers and primary identification columns.
- **Desktop (`1024px - 1599px`)**: Standard accounting view. 12-column fluid grid, 256px dedicated sidebar with multi-tenant company switchers, `1.5rem` gutters, and `2rem` workspace margins.
- **Wide Workstation (`>= 1600px`)**: Multi-pane audit view enabled. Split screens accommodate source document XML/PDF visualization on the left and automated chart-of-accounts mapping on the right without horizontal clipping.

### Density Rhythm
Spacers scale in strict 4px increments. Data tables utilize compact row heights (36px default, 32px high-density mode) to display maximum actionable lines per viewport without visual occlusion.

## Elevation & Depth
Depth in the design system is defined through structural boundaries and low-contrast borders rather than deep perspective drop-shadows, mirroring the flat precision of modern development and financial tools.

### Elevation Hierarchy
- **Level 0 (Base Canvas)**: `#F8FAFC`. Background layer beneath all modules, workspaces, and navigation structures.
- **Level 1 (Panels, Cards, and Tables)**: Surface color `#FFFFFF` with a crisp border: `1px solid #E2E8F0`. Shadow is strictly ambient: `0 1px 2px 0 rgba(15, 23, 42, 0.04)`.
- **Level 2 (Hover States, Interactive Cards, Active Filter Bars)**: Retains `#FFFFFF` surface with intensified border: `1px solid #CBD5E1`. Shadow: `0 4px 6px -1px rgba(15, 23, 42, 0.06), 0 2px 4px -2px rgba(15, 23, 42, 0.04)`.
- **Level 3 (Dropdowns, Multi-Company Popovers, Fiscal Date Pickers)**: Surface `#FFFFFF`, border `1px solid #CBD5E1`, elevated with shadow: `0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)`.
- **Level 4 (Audit Modals, Certificate Upload Drawers)**: Backdrop overlay `rgba(15, 23, 42, 0.6)` with backdrop blur `4px`. Foreground surface `#FFFFFF`, outline `1px solid #E2E8F0`, shadow `0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`.

## Shapes
A conservative, disciplined shape profile (`roundedness: 1` — Soft / 0.25rem baseline) reinforces systemic structure and structural density.

### Radius Specifications
- **Micro Elements (`rounded-sm` / 2px - 4px)**: Badges, table status indicators, inline code tags (CFOP, NCM), and checkboxes.
- **Standard Controls (`rounded-md` / 6px)**: Form text fields, select inputs, secondary action buttons, tabs, and segmented controls.
- **Containers (`rounded-lg` / 8px)**: Summary cards, analytical charts, modal frames, and master data tables.
- **Rounded Corners Over 12px**: Strictly prohibited for core controls. Pill shapes are reserved solely for live telemetry pills (e.g., active SEFAZ connection status dots) to signify continuous dynamic polling.

## Components

### Buttons
- **Primary**: Solid `#0F172A` with `#FFFFFF` text. Subtle inner highlight on hover (`#1E293B`), active scale compression `0.99`.
- **Secondary / Outline**: Background `#FFFFFF`, border `1px solid #E2E8F0`, text `#0F172A`. Hover: background `#F8FAFC`, border `#CBD5E1`.
- **AI Automation**: Gradient border or solid `#D6A40E` with `#FFFFFF` text. Used for actions such as "Reconciliar em Lote", "Sugerir Classificação Fiscal", and "Auditar com IA".
- **Institutional Authentication (Gov.br & Certificado A1/A3)**: Distinctive variants. Gov.br uses dedicated system blue accents; Certificate actions include a security padlock icon, expiration badge, and high-trust status indicator.

### Status Badges (Semáforo Fiscal)
- Composed of 6px horizontal padding, 2px vertical padding, `JetBrains Mono` font for numeric codes, and `Inter` for descriptive labels.
- Format: `[Status Indicator Dot] + [Label]`.
  - *Conforme*: Light green surface (`#ECFDF5`), green text (`#065F46`), green dot (`#10B981`).
  - *Atenção (D-3)*: Light amber surface (`#FFFBEB`), amber text (`#92400E`), pulsing amber dot (`#F59E0B`).
  - *Crítico (Sefaz Rejeitado)*: Light red surface (`#FEF2F2`), red text (`#991B1B`), solid red dot (`#EF4444`).

### Form Controls & Inputs
- **Text Inputs**: Height 36px (compact). Surface `#FFFFFF`, border `1px solid #E2E8F0`, text `#0F172A`. Focus state: border `#0F172A` with a `2px` ring in `#0F172A/10`.
- **Monetary & Code Inputs**: Left-adorned with static prefixes (`R$`, `Chave:`, `CNPJ:`) rendered in `#64748B`. Font set to `JetBrains Mono`.
- **Validation Messages**: Placed directly below the field in 11px font with an accompanying alert icon. Colors strictly follow the fiscal severity scale.

### Data Tables (Livro Razão & Documentos Fiscais)
- Alternating subtle row backgrounds on hover (`#F8FAFC`).
- Cell padding: 8px vertical, 12px horizontal. Border-bottom: `1px solid #F1F5F9`.
- Headers: Background `#F8FAFC`, border-bottom `1px solid #E2E8F0`, typography `label-sm` uppercase tracking in `#64748B`.
- Numeric data columns are right-aligned with `tnum` font features.

### Multi-Tenant Company Selector
- Persistent top-level navigation component displaying the current active client company, its CNPJ mask in `JetBrains Mono`, tax regime tag (Simples Nacional, Lucro Presumido, Lucro Real), and quick-search switcher shortcut (`Cmd + K`).

### Cards & Summary KPI Blocks
- `#FFFFFF` surface with `1px solid #E2E8F0`.
- Metrics are highlighted with large Geist numbers, followed by fiscal delta trends (e.g., "vs. competência anterior") tagged in green or red depending on whether the variance represents positive cash flow or increased tax exposure.