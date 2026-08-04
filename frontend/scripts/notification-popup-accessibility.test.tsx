import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import {
  NotificationPopup,
  NotificationPopupController,
  type NotificationTimerScheduler,
} from '../src/components/notificationPopupController';
import type { RequestNotification } from '../src/lib/requestNotifications';

const viewed: RequestNotification = {
  eventId: 'request-viewed:41',
  kind: 'request-viewed',
  requestId: 41,
  fulfillmentBranch: 'NY',
};

class FakeTimers implements NotificationTimerScheduler {
  nowMs = 0;
  nextId = 1;
  timers = new Map<number, { dueAt: number; callback: () => void }>();

  now() {
    return this.nowMs;
  }

  setTimeout(callback: () => void, delay: number) {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.nowMs + delay, callback });
    return id;
  }

  clearTimeout(id: unknown) {
    this.timers.delete(id as number);
  }

  advance(milliseconds: number) {
    const target = this.nowMs + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!due) break;
      const [id, timer] = due;
      this.nowMs = timer.dueAt;
      this.timers.delete(id);
      timer.callback();
    }
    this.nowMs = target;
  }
}

function mountedPopup(callbacks: {
  open: () => void;
  dismiss: () => void;
  pause: () => void;
  resume: () => void;
}): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<NotificationPopup notification={viewed} {...callbacks} />);
  });
  return renderer;
}

test('mounted popup uses separate native buttons and a polite non-interactive announcement', () => {
  const events: string[] = [];
  const renderer = mountedPopup({
    open: () => events.push('open'),
    dismiss: () => events.push('dismiss'),
    pause: () => events.push('pause'),
    resume: () => events.push('resume'),
  });

  const liveRegion = renderer.root.findByProps({ 'aria-live': 'polite' });
  const popup = renderer.root.findByProps({ role: 'group' });
  const buttons = renderer.root.findAllByType('button');
  const open = buttons.find((button) => button.props.children === 'Open request');
  const dismiss = buttons.find((button) => button.props['aria-label'] === 'Dismiss Request #41 viewed');

  assert.equal(liveRegion.props.role, undefined);
  assert.equal(renderer.root.findAllByProps({ role: 'status' }).length, 0);
  assert.equal(buttons.length, 2);
  assert.equal(open?.props.type, 'button');
  assert.equal(open?.props.onKeyDown, undefined, 'native button activation handles Enter and Space');
  assert.equal(dismiss?.props.type, 'button');
  assert.equal(popup.props['aria-label'], 'Request notification: Request #41 viewed');

  act(() => { open?.props.onClick(); });
  assert.deepEqual(events, ['dismiss', 'open']);
  act(() => { dismiss?.props.onClick(); });
  assert.deepEqual(events, ['dismiss', 'open', 'dismiss'], 'Dismiss never opens the request');
  renderer.unmount();
});

test('mounted popup keeps its timer paused until both hover and focus-within end', () => {
  const events: string[] = [];
  const renderer = mountedPopup({
    open() {}, dismiss() {},
    pause: () => events.push('pause'),
    resume: () => events.push('resume'),
  });
  const popup = renderer.root.findByProps({ role: 'group' });

  act(() => { popup.props.onPointerEnter(); popup.props.onFocus(); popup.props.onPointerLeave(); });
  assert.deepEqual(events, ['pause', 'pause']);
  act(() => {
    popup.props.onBlur({ currentTarget: { contains: () => true }, relatedTarget: {} });
  });
  act(() => {
    popup.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  });

  assert.deepEqual(events, ['pause', 'pause', 'resume']);
  renderer.unmount();

  const reciprocalEvents: string[] = [];
  const reciprocal = mountedPopup({
    open() {}, dismiss() {},
    pause: () => reciprocalEvents.push('pause'),
    resume: () => reciprocalEvents.push('resume'),
  });
  const reciprocalPopup = reciprocal.root.findByProps({ role: 'group' });
  act(() => { reciprocalPopup.props.onFocus(); reciprocalPopup.props.onPointerEnter(); });
  act(() => {
    reciprocalPopup.props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  });
  assert.deepEqual(reciprocalEvents, ['pause', 'pause']);
  act(() => { reciprocalPopup.props.onPointerLeave(); });
  assert.deepEqual(reciprocalEvents, ['pause', 'pause', 'resume']);
  reciprocal.unmount();
});

test('controller auto-dismisses after ten seconds of active time', () => {
  const timers = new FakeTimers();
  const changes: string[][] = [];
  const controller = new NotificationPopupController((items) => {
    changes.push(items.map((item) => item.eventId));
  }, timers);

  controller.receive(viewed);
  timers.advance(9_999);
  assert.deepEqual(changes.at(-1), ['request-viewed:41']);
  timers.advance(1);

  assert.deepEqual(changes, [['request-viewed:41'], []]);
  assert.equal(timers.timers.size, 0);
});

test('controller resumes a hovered notification with only its remaining active time', () => {
  const timers = new FakeTimers();
  const changes: string[][] = [];
  const controller = new NotificationPopupController((items) => {
    changes.push(items.map((item) => item.eventId));
  }, timers);

  controller.receive(viewed);
  timers.advance(3_000);
  controller.pause(viewed.eventId);
  timers.advance(20_000);
  assert.deepEqual(changes.at(-1), ['request-viewed:41']);
  controller.resume(viewed.eventId);
  timers.advance(6_999);
  assert.deepEqual(changes.at(-1), ['request-viewed:41']);
  timers.advance(1);

  assert.deepEqual(changes.at(-1), []);
});

test('controller creates one active timer for duplicate events and releases its ID on dismiss', () => {
  const timers = new FakeTimers();
  const changes: string[][] = [];
  const controller = new NotificationPopupController((items) => {
    changes.push(items.map((item) => item.eventId));
  }, timers);

  controller.receive(viewed);
  controller.receive(viewed);
  assert.equal(timers.timers.size, 1);
  assert.deepEqual(changes, [['request-viewed:41']]);

  controller.dismiss(viewed.eventId);
  assert.equal(timers.timers.size, 0);
  controller.receive(viewed);
  assert.equal(timers.timers.size, 1);
  assert.deepEqual(changes, [['request-viewed:41'], [], ['request-viewed:41']]);
});

test('controller cancellation on manual dismiss and unmount prevents stale timer callbacks', () => {
  const timers = new FakeTimers();
  const changes: string[][] = [];
  const controller = new NotificationPopupController((items) => {
    changes.push(items.map((item) => item.eventId));
  }, timers);

  controller.receive(viewed);
  controller.dismiss(viewed.eventId);
  timers.advance(10_000);
  assert.deepEqual(changes, [['request-viewed:41'], []]);

  controller.receive(viewed);
  controller.dispose();
  timers.advance(10_000);
  assert.deepEqual(changes, [['request-viewed:41'], [], ['request-viewed:41']]);
  assert.equal(timers.timers.size, 0);
});
