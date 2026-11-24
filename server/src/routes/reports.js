import { Router } from 'express';
import ExcelJS from 'exceljs';
import { Op, fn, col } from 'sequelize';
import { User, Task, TimeEntry } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { dayKey, teamIds } from '../utils/helpers.js';
import { buildTimesheet } from './time.js';

const router = Router();
router.use(requireAuth);

// Admin: all employees. Manager: own team. (Employees use /time/timesheet for their own summary.)
router.get('/summary', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const ids = await teamIds(req.user);
  const today = dayKey();
  const [totalEmployees, activeEmployees, currentlyWorking, todayEntries, taskCounts, overdueTasks] = await Promise.all([
    req.user.role === 'admin' ? User.count() : User.count({ where: { id: ids } }), // total includes deactivated accounts
    User.count({ where: { id: ids, isActive: true } }),
    TimeEntry.count({ where: { UserId: ids, clockOut: null } }),
    TimeEntry.findAll({ where: { UserId: ids, date: today } }),
    Task.findAll({ attributes: ['status', [fn('COUNT', col('id')), 'n']], where: { assigneeId: ids }, group: ['status'], raw: true }),
    Task.count({ where: { assigneeId: ids, status: { [Op.ne]: 'completed' }, dueDate: { [Op.lt]: new Date() } } }),
  ]);
  res.json({
    totalEmployees, activeEmployees, currentlyWorking, overdueTasks,
    presentToday: new Set(todayEntries.map((e) => e.UserId)).size,
    minutesWorkedToday: todayEntries.reduce((s, e) => s + e.workedMinutes(), 0),
    tasks: Object.fromEntries(taskCounts.map((t) => [t.status, Number(t.n)])),
  });
}));

router.get('/timesheets', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const { from = dayKey(), to = dayKey(), userId } = req.query;
  const allowed = await teamIds(req.user);
  const ids = userId ? allowed.filter((id) => id === Number(userId)) : allowed;
  res.json(await buildTimesheet(ids, from, to));
}));

router.get('/timesheets/export.xlsx', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const { from = dayKey(), to = dayKey() } = req.query;
  const rows = await buildTimesheet(await teamIds(req.user), from, to);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Timesheets');
  ws.columns = [
    { header: 'Employee', key: 'name', width: 24 }, { header: 'Department', key: 'department', width: 18 },
    { header: 'Date', key: 'date', width: 12 }, { header: 'Worked (h)', key: 'hours', width: 12 },
    { header: 'Overtime (h)', key: 'ot', width: 12 }, { header: 'Late', key: 'late', width: 8 },
  ];
  rows.forEach((r) => ws.addRow({ ...r, hours: +(r.minutes / 60).toFixed(2), ot: +(r.overtimeMinutes / 60).toFixed(2), late: r.late ? 'Yes' : 'No' }));
  ws.getRow(1).font = { bold: true };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="timesheets_${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));
// TODO: PDF export (e.g. pdfkit) for the agreed report formats.

export default router;
