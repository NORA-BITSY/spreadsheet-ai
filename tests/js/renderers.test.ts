import { describe, expect, it, vi } from 'vitest';
import { GridCellKind, type Theme } from '@glideapps/glide-data-grid';
import { agenticCellRenderer, cellSummaryText, type AgenticCellData } from '../../resources/js/grid/renderers';
import { ALL_FORMAT_KEYS } from '../../resources/js/lib/formats';

function data(partial: Partial<AgenticCellData>): AgenticCellData {
    return {
        kind: 'agentic-cell',
        format: 'text',
        value: 'hi',
        flag: 'green',
        confidence: 0.9,
        citationIndex: null,
        citationCount: 0,
        ...partial,
    };
}

function makeMockCtx() {
    const fillText = vi.fn();
    const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        arcTo: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        arc: vi.fn(),
        fillText,
        measureText: vi.fn((t: string) => ({ width: t.length * 7 })),
        fillStyle: '',
        font: '',
        textBaseline: 'alphabetic',
        textAlign: 'left',
        globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    return { ctx, fillText };
}

const mockTheme = {
    textDark: '#f5f5f7',
    textLight: '#6e6e76',
    baseFontStyle: '13px',
    fontFamily: 'Geist, sans-serif',
} as Theme;

describe('agenticCellRenderer', () => {
    it('declares the Custom kind and matches our cell data', () => {
        expect(agenticCellRenderer.kind).toBe(GridCellKind.Custom);
        const matching = { data: data({}) } as never;
        const other = { data: { kind: 'other' } } as never;
        expect(agenticCellRenderer.isMatch(matching)).toBe(true);
        expect(agenticCellRenderer.isMatch(other)).toBe(false);
    });

    it('smoke-tests draw() across all 17 formats with normal, malformed, string, NaN, and null values', () => {
        const samplesByFormat: Record<string, unknown[]> = {
            text: ['Hello world', null, '', { nested: 1 }],
            bulleted_list: [['a', 'b'], [{ name: 'Obj item' }], '• line 1\n• line 2', null],
            number: [42, '1,234', Number.NaN, null],
            percentage: ['+18%', '-5%', 'not-a-num', Number.NaN, null],
            monetary_amount: ['52,40 EUR', '100', null],
            currency: ['EUR', null],
            yes_no: ['Yes', 'No', null],
            date: ['2026-05-15', '2026-05-15T12:34:56Z very long date string', null],
            tag: ['High', '', null],
            enum: ['Wrong Size', null],
            enum_status: ['in_progress', 'unknown_status', null],
            rating: [4, 3.7, 'bad', Number.NaN, null],
            url: ['https://example.com/a', 'javascript:alert(1)', null],
            person: [
                { name: 'Sara Conte', initials: 'SC', hue: 120 },
                { name: 'NaN Hue', hue: Number.NaN },
                'Mario Rossi',
                null,
            ],
            tags_multi: [['a', 'b'], [{ label: 'ObjTag' }], 'tag1, tag2', null],
            relation: [{ kind: 'order', label: 'ordini:94521' }, 'clienti:12345', null],
            json_path: ['+18%', '52,40 EUR', 94, '2026-05-15', 'plain', null],
        };

        for (const fmt of ALL_FORMAT_KEYS) {
            const samples = samplesByFormat[fmt] ?? ['fallback', null];
            for (const value of samples) {
                const { ctx, fillText } = makeMockCtx();
                const cell = {
                    kind: GridCellKind.Custom,
                    allowOverlay: false,
                    copyData: '',
                    data: data({
                        format: fmt,
                        value,
                        confidence: value === null ? Number.NaN : 0.4,
                        citationIndex: 1,
                        citationCount: 1,
                    }),
                };
                const res = agenticCellRenderer.draw(
                    {
                        ctx,
                        theme: mockTheme,
                        rect: { x: 0, y: 0, width: 160, height: 40 },
                    } as never,
                    cell as never,
                );
                expect(res).toBe(true);
                // Must never render literal "[object Object]"
                for (const call of fillText.mock.calls) {
                    expect(String(call[0])).not.toContain('[object Object]');
                }
            }
        }
    });
});

describe('cellSummaryText — copyData + a11y mirror text', () => {
    it('renders rating as rounded clamped n/5 and em-dash on invalid', () => {
        expect(cellSummaryText(data({ format: 'rating', value: 4 }))).toBe('4/5');
        expect(cellSummaryText(data({ format: 'rating', value: 3.7 }))).toBe('4/5');
        expect(cellSummaryText(data({ format: 'rating', value: '7' }))).toBe('5/5'); // clamped
        expect(cellSummaryText(data({ format: 'rating', value: 'invalid' }))).toBe('—');
    });
    it('renders percentage and json_path verbatim-ish', () => {
        expect(cellSummaryText(data({ format: 'percentage', value: '+18%' }))).toBe('+18%');
        expect(cellSummaryText(data({ format: 'json_path', value: 94 }))).toBe('94');
    });
    it('flattens arrays and person objects', () => {
        expect(cellSummaryText(data({ format: 'tags_multi', value: ['a', 'b'] }))).toBe('a · b');
        expect(cellSummaryText(data({ format: 'person', value: { name: 'Sara Conte', initials: 'SC' } }))).toBe(
            'Sara Conte',
        );
    });
});
