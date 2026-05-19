import { prisma } from "./prisma";

export async function getEmployeeShiftTimes(employee: { shiftType: string }) {
  const shift = await prisma.shift.findFirst({
    where: { type: employee.shiftType, isActive: true },
  });
  if (!shift) {
    return { startMinutes: 9 * 60, endMinutes: 18 * 60, lateThreshold: 15, earlyExitThreshold: 30 };
  }
  const [sh, sm] = shift.startTime.split(":").map(Number);
  const [eh, em] = shift.endTime.split(":").map(Number);
  return {
    startMinutes: sh * 60 + sm,
    endMinutes: eh * 60 + em,
    lateThreshold: shift.lateThreshold,
    earlyExitThreshold: shift.earlyExitThreshold,
  };
}

export function minutesToHM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
