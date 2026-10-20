/**
 * AR-1 acceptance criterion (KAN-106): "Leaving AR returns the user to the
 * same selected zone".
 *
 * The real Twin and AR scene draw WebGL, which a simulated browser cannot do,
 * so both are replaced by small stand-ins that expose only what App wires to
 * them: the selected zone and the onSelect / onExit callbacks. Everything else
 * (App's state, the AR chip, the sidebar) is the real code.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const support = vi.hoisted(() => ({ current: { status: 'supported', supported: true } }));

vi.mock('./DigitalTwin.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real, // keep zonesFor / DEMO_ZONES: App derives its zones from them
    default: function TwinStandIn({ spec, selected, onSelect }) {
      const zone = real.zonesFor(spec)[0];
      return (
        <div>
          <button onClick={() => onSelect(zone)}>pick-zone</button>
          <output data-testid="twin-selected">{selected?.id ?? 'none'}</output>
        </div>
      );
    },
  };
});
vi.mock('./RealisticTwin.jsx', () => ({ default: () => null }));
vi.mock('./RoomView.jsx', () => ({ default: () => null }));
vi.mock('./ar/ARView.jsx', () => ({
  default: function ARStandIn({ selected, onExit }) {
    return (
      <div data-testid="ar-view">
        <output data-testid="ar-selected">{selected?.id ?? 'none'}</output>
        <button onClick={onExit}>leave-ar</button>
      </div>
    );
  },
}));
vi.mock('./ar/arSupport.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useArSupport: () => support.current,
}));

const { default: App } = await import('./App.jsx');
const { zonesFor } = await import('./DigitalTwin.jsx');
const { PROJECTS } = await import('./projects.js');

const firstZone = zonesFor(PROJECTS[0])[0];

beforeEach(() => {
  support.current = { status: 'supported', supported: true };
});
afterEach(cleanup);

describe('AR-1: entering and leaving AR keeps the selected zone', () => {
  it('returns to the Twin with the same zone selected', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('pick-zone'));
    expect(screen.getByTestId('twin-selected').textContent).toBe(firstZone.id);

    fireEvent.click(screen.getByText(/צפייה ב-AR/));
    const ar = await screen.findByTestId('ar-view');
    expect(ar).toBeTruthy();
    expect(screen.getByTestId('ar-selected').textContent).toBe(firstZone.id);

    fireEvent.click(screen.getByText('leave-ar'));
    expect(screen.queryByTestId('ar-view')).toBeNull();
    expect(screen.getByTestId('twin-selected').textContent).toBe(firstZone.id);
    expect(screen.getByText(firstZone.label)).toBeTruthy(); // sidebar still shows it
    expect(screen.getByText(/צפייה ב-AR/)).toBeTruthy(); // and the entry point is back
  });

  it('on a device without AR the Twin shows the one-line note and no AR button', () => {
    support.current = { status: 'unsupported', supported: false, reason: 'no-webxr' };
    render(<App />);
    expect(screen.queryByText(/צפייה ב-AR/)).toBeNull();
    expect(screen.getByRole('note').textContent).toContain('AR לא נתמך בדפדפן זה');
  });
});
