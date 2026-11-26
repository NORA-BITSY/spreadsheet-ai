// ============================================================
// Map our Tailwind-v4 / tokens.css CSS variables to a Glide DataEditor theme,
// so the canvas matches dark/light mode. Reads concrete values via
// getComputedStyle (Glide needs real color strings, not var(...) refs).
// ============================================================

import type { Theme } from '@glideapps/glide-data-grid';

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
    const v = styles.getPropertyValue(name).trim();
    return v === '' ? fallback : v;
}

export interface GlideThemeBundle {
    theme: Partial<Theme>;
    aiHeaderColor: string;
}

/**
 * Resolve the `--ai` CSS token to a concrete color string for Canvas 2D
 * (`themeOverride.textHeader` cannot use `var(--ai)`).
 */
export function resolveAiColor(): string {
    const fallback = '#8b5cf6';
    if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
        const s = getComputedStyle(document.documentElement);
        return readVar(s, '--ai', fallback);
    }
    return fallback;
}

/**
 * Build a partial Glide theme from the document's resolved CSS tokens.
 * Safe in non-DOM environments (returns sensible dark defaults).
 */
export function buildGlideTheme(): Partial<Theme> & { aiHeaderColor?: string } {
    const dark = {
        bg: '#0a0a0b',
        bgElevated: '#111113',
        bgSubtle: '#161618',
        border: '#232327',
        text: '#f5f5f7',
        textSecondary: '#a1a1a8',
        textTertiary: '#6e6e76',
        accent: '#8b5cf6',
        ai: '#8b5cf6',
    };

    let t = dark;
    if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
        const s = getComputedStyle(document.documentElement);
        t = {
            bg: readVar(s, '--bg', dark.bg),
            bgElevated: readVar(s, '--bg-elevated', dark.bgElevated),
            bgSubtle: readVar(s, '--bg-subtle', dark.bgSubtle),
            border: readVar(s, '--border', dark.border),
            text: readVar(s, '--text', dark.text),
            textSecondary: readVar(s, '--text-secondary', dark.textSecondary),
            textTertiary: readVar(s, '--text-tertiary', dark.textTertiary),
            accent: readVar(s, '--accent', dark.accent),
            ai: readVar(s, '--ai', dark.ai),
        };
    }

    return {
        accentColor: t.accent,
        accentLight: 'rgba(139,92,246,0.12)',
        textDark: t.text,
        textMedium: t.textSecondary,
        textLight: t.textTertiary,
        textBubble: t.text,
        bgIconHeader: t.textSecondary,
        fgIconHeader: t.bgElevated,
        textHeader: t.text,
        textHeaderSelected: t.text,
        bgCell: t.bgElevated,
        bgCellMedium: t.bgSubtle,
        bgHeader: t.bgElevated,
        bgHeaderHasFocus: t.bgSubtle,
        bgHeaderHovered: t.bgSubtle,
        bgBubble: t.bgSubtle,
        bgBubbleSelected: t.bgSubtle,
        bgSearchResult: 'rgba(245,158,11,0.2)',
        borderColor: t.border,
        horizontalBorderColor: t.border,
        drilldownBorder: t.border,
        linkColor: t.accent,
        aiHeaderColor: t.ai,
        cellHorizontalPadding: 8,
        cellVerticalPadding: 3,
        headerFontStyle: '600 12px',
        baseFontStyle: '13px',
        fontFamily:
            "'Geist', ui-sans-serif, system-ui, -apple-system, sans-serif",
        editorFontSize: '13px',
    };
}
