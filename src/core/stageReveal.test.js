import { describe, it, expect } from 'vitest';
import { revealOnMount } from './stageReveal.js';

function listOf(n) {
  const list = document.createElement('ul');
  for (let i = 0; i < n; i += 1) {
    const li = document.createElement('li');
    li.className = 'stage-reveal-item';
    list.append(li);
  }
  return list;
}
const finish = (node) => node.dispatchEvent(new Event('animationend', { bubbles: true }));

describe('revealOnMount', () => {
  it('turns the rise-in on for a list with items, and returns the list', () => {
    const list = listOf(3);
    expect(revealOnMount(list)).toBe(list);
    expect(list.classList.contains('stage-reveal')).toBe(true);
  });

  it('turns it off when the LAST item has finished, so a re-attach does not replay it', () => {
    const list = listOf(3);
    revealOnMount(list);
    finish(list.children[0]);
    expect(list.classList.contains('stage-reveal')).toBe(true); // the first item finishing is not the end
    finish(list.children[2]);
    expect(list.classList.contains('stage-reveal')).toBe(false);
  });

  it('ignores an animation that ended on something inside the last item', () => {
    const list = listOf(1);
    const inner = document.createElement('span');
    list.children[0].append(inner);
    revealOnMount(list);
    finish(inner);
    expect(list.classList.contains('stage-reveal')).toBe(true);
  });

  it('only counts items that opted in', () => {
    const list = listOf(1);
    const plain = document.createElement('li');
    list.append(plain);
    revealOnMount(list);
    finish(list.children[0]);
    expect(list.classList.contains('stage-reveal')).toBe(false);
  });

  it('leaves a list with no items alone', () => {
    const list = listOf(0);
    revealOnMount(list);
    expect(list.classList.contains('stage-reveal')).toBe(false);
  });
});
