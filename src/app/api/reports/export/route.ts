import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function toCSV(data: any[], fields: string[], headers: string[]): string {
  const headerRow = headers.join(",");
  const rows = data.map((row) =>
    fields.map((f) => {
      const val = row[f] ?? "";
      const str = String(val);
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    }).join(",")
  );
  return [headerRow, ...rows].join("\n");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "attendance";
    const start = searchParams.get("startDate") || searchParams.get("from") || new Date().toISOString().split("T")[0];
    const end = searchParams.get("endDate") || searchParams.get("to") || new Date().toISOString().split("T")[0];
    const format = searchParams.get("format") || "json";

    let data: any[] = [];
    let fields: string[] = [];
    let headers: string[] = [];
    let filename = "export";

    switch (type) {
      case "attendance": {
        const logs = await prisma.attendanceLog.findMany({
          where: { date: { gte: start, lte: end } },
          include: { employee: { select: { employeeCode: true, firstName: true, lastName: true, department: true } } },
          orderBy: [{ date: "desc" }, { inTime: "asc" }],
        });
        data = logs.map((l) => ({
          employeeCode: l.employee?.employeeCode || "",
          name: `${l.employee?.firstName || ""} ${l.employee?.lastName || ""}`,
          department: l.employee?.department || "",
          date: l.date,
          inTime: l.inTime || "",
          outTime: l.outTime || "",
          status: l.status || "",
          lateMinutes: l.lateMinutes || 0,
          source: l.source || "MANUAL",
        }));
        fields = ["employeeCode", "name", "department", "date", "inTime", "outTime", "status", "lateMinutes", "source"];
        headers = ["Employee Code", "Name", "Department", "Date", "In Time", "Out Time", "Status", "Late (min)", "Source"];
        filename = `attendance_${start}_${end}`;
        break;
      }
      case "face-detections": {
        const logs = await prisma.faceDetectionLog.findMany({
          where: { date: { gte: start, lte: end } },
          include: { employee: { select: { employeeCode: true, firstName: true, lastName: true, department: true } } },
          orderBy: [{ date: "desc" }, { time: "asc" }],
        });
        data = logs.map((l) => ({
          employeeCode: l.employee?.employeeCode || "",
          name: `${l.employee?.firstName || ""} ${l.employee?.lastName || ""}`,
          department: l.employee?.department || "",
          date: l.date,
          time: l.time,
          type: l.type,
        }));
        fields = ["employeeCode", "name", "department", "date", "time", "type"];
        headers = ["Employee Code", "Name", "Department", "Date", "Time", "Type"];
        filename = `face_detections_${start}_${end}`;
        break;
      }
      case "employees": {
        const emps = await prisma.employee.findMany({ orderBy: { firstName: "asc" } });
        data = emps.map((e) => ({
          employeeCode: e.employeeCode || "",
          firstName: e.firstName,
          lastName: e.lastName,
          email: e.email || "",
          mobile: e.mobile || "",
          department: e.department || "",
          designation: e.designation || "",
          status: e.status,
          joinDate: e.joinDate ? String(e.joinDate).split("T")[0] : "",
        }));
        fields = ["employeeCode", "firstName", "lastName", "email", "mobile", "department", "designation", "status", "joinDate"];
        headers = ["Code", "First Name", "Last Name", "Email", "Mobile", "Department", "Designation", "Status", "Join Date"];
        filename = `employees_${start}`;
        break;
      }
      default:
        return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    if (format === "csv") {
      const csv = toCSV(data, fields, headers);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
        },
      });
    }

    return NextResponse.json({ data, fields, headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
