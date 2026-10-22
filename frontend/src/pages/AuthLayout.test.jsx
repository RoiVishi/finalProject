/**
 * The auth screens' AR backdrop is decoration only: hidden from assistive
 * technology, never in the way of the form, and it follows the viewport
 * (narrow screens crop the stage around the building).
 */
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthLayout } from './AuthLayout.jsx';
import AuthBackdrop from './AuthBackdrop.jsx';

function setViewport(narrow) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: narrow && query === '(max-width: 760px)',
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

describe('AuthLayout backdrop', () => {
  afterEach(() => { cleanup(); delete window.matchMedia; });

  it('renders the form card over a backdrop hidden from screen readers', () => {
    setViewport(false);
    const { container } = render(<AuthLayout title="כניסה למערכת"><input aria-label="אימייל" /></AuthLayout>);
    const backdrop = container.querySelector('svg.auth-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('main', { name: 'כניסה למערכת' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'אימייל' })).toBeTruthy();
    // the decorative AR labels sit inside the hidden backdrop, not in the content
    expect(screen.getByText('קומה 3 · סיכון בינוני').closest('[aria-hidden="true"]')).toBe(backdrop);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('covers wide screens with the stage and fits the whole building on top of narrow ones', () => {
    setViewport(false);
    const wide = render(<AuthLayout title="t"><span /></AuthLayout>);
    const w = wide.container.querySelector('svg.auth-backdrop');
    expect(w.getAttribute('viewBox')).toBe('0 0 1440 900');
    expect(w.getAttribute('preserveAspectRatio')).toBe('xMidYMid slice');
    cleanup();
    setViewport(true);
    const narrow = render(<AuthLayout title="t"><span /></AuthLayout>);
    const n = narrow.container.querySelector('svg.auth-backdrop');
    expect(n.getAttribute('viewBox')).toBe('200 40 620 860');
    expect(n.getAttribute('preserveAspectRatio')).toBe('xMidYMin meet');
  });

  it('loads the plant images from the app itself, not from the network', () => {
    setViewport(false);
    const { container } = render(<AuthLayout title="t"><span /></AuthLayout>);
    const hrefs = [...container.querySelectorAll('svg.auth-backdrop image')].map((i) => i.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h.startsWith('/auth/'))).toBe(true);
  });

  it('still works where matchMedia does not exist', () => {
    delete window.matchMedia;
    const { container } = render(<AuthLayout title="t"><span /></AuthLayout>);
    expect(container.querySelector('svg.auth-backdrop').getAttribute('viewBox')).toBe('0 0 1440 900');
  });

  it('ambient (signed-in screens): the same picture, still, without risk markings or labels', () => {
    setViewport(false);
    const auth = render(<AuthBackdrop />).container.querySelector('svg');
    const authImages = auth.querySelectorAll('image').length;
    cleanup();
    const { container } = render(<AuthBackdrop ambient />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('class')).toBe('app-backdrop');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('image').length).toBe(authImages);    // same courtyard
    expect(svg.querySelector('.fs-scan, .fs-pulse')).toBeNull();       // nothing moves
    expect(svg.querySelectorAll('text').length).toBe(0);               // no 'floor 3 · medium risk'
    expect(svg.querySelector('[stroke="#fbbf24"]')).toBeNull();         // no amber risk floor
  });
});
