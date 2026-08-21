import { describe, it, expect } from 'vitest';
import { mountApp } from './main.js';

describe('mountApp', () => {
  it('renders the app name into the root element', () => {
    const root = document.createElement('div');
    mountApp(root);
    expect(root.textContent).toBe('Seduh Score Next');
  });
});
