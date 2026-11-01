// Пример объекта — чтобы за секунду показать, как выглядит готовый результат.
import { newProject, uid } from './db.js';
import { rectPoints } from './geometry.js';

export function demoProject() {
  const p = newProject('Пример: 2-комнатная квартира');
  const room = (type, x, y, w, h, name = '') => ({ id: uid(), type, name, points: rectPoints(x, y, w, h) });

  // Стена 12 см: соседние комнаты стоят через 12 см.
  const r1 = room('room', 0, 0, 420, 380);
  const r2 = room('room', 432, 0, 330, 380);
  const kitchen = room('kitchen', 774, 0, 290, 380);
  const hall = room('hall', 0, 392, 1064, 150);
  const bath = room('bath', 0, 554, 170, 200);
  const wc = room('wc', 182, 554, 120, 200);
  const balcony = room('balcony', 40, -132, 300, 120);
  p.plan.rooms = [r1, r2, kitchen, hall, bath, wc, balcony];

  // Рёбра прямоугольника: 0 — верх, 1 — право, 2 — низ, 3 — лево.
  const op = (type, r, edge, t, width, extra = {}) => ({ id: uid(), type, roomId: r.id, edge, t, width, swing: 'in', hinge: 'a', ...extra });
  p.plan.openings = [
    op('door', r1, 0, 0.2, 75),
    op('window', r1, 0, 0.65, 140),
    op('window', r2, 0, 0.5, 150),
    op('window', kitchen, 0, 0.5, 120),
    op('window', balcony, 0, 0.5, 240),
    op('door', r1, 2, 0.5, 80),
    op('door', r2, 2, 0.5, 80),
    op('arch', kitchen, 2, 0.5, 90),
    op('door', bath, 0, 0.5, 70),
    op('door', wc, 0, 0.5, 70),
    op('door', hall, 1, 0.5, 90),
  ];

  Object.assign(p, {
    address: 'Город, улица, дом (пример)',
    price: '8900000',
    floor: '7',
    floors: '16',
    description: 'Светлая квартира с раздельными комнатами и просторной кухней. Окна на две стороны, '
      + 'застеклённый балкон. Рядом школа, детский сад и остановка. Это пример — замените текст на свой.',
  });
  return p;
}
