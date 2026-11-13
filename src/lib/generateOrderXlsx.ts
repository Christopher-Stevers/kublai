import { utils, write } from "xlsx";

interface OrderItem {
  quantity: string;
  descriptionSnapshot: string | null;
  supplierSkuSnapshot: string | null;
  sizeUnitCode?: string | null;
}

interface OrderData {
  jobName: string;
  supplierName: string;
  items: OrderItem[];
  notes?: string | null;
}

/**
 * Parse size and material from description
 * Format: "Description - Size\" (Material)" or just "Description"
 */
function parseDescription(description: string | null): {
  description: string;
  size: string;
  material: string;
} {
  if (!description) {
    return { description: "", size: "", material: "" };
  }

  // Try to match pattern: "Description - Size\" (Material)"
  const match = description.match(/^(.*?)\s+-\s+([\d\-\/]+)"?\s*\((.*?)\)$/);
  if (match) {
    return {
      description: match[1]?.trim() ?? "",
      size: match[2]?.trim() ?? "",
      material: match[3]?.trim() ?? "",
    };
  }

  // Try to match: "Description (Material)"
  const simpleMatch = description.match(/^(.*?)\s*\((.*?)\)$/);
  if (simpleMatch) {
    return {
      description: simpleMatch[1]?.trim() ?? "",
      size: "",
      material: simpleMatch[2]?.trim() ?? "",
    };
  }

  return { description, size: "", material: "" };
}

/**
 * Format size with unit
 * e.g., "6" + "in" = "6 in."
 * e.g., "1-1/4" + "in" = "1-1/4 in."
 */
function formatSizeWithUnit(
  size: string,
  unitCode: string | null | undefined,
): string {
  if (!size) return "";
  if (!unitCode) return size;
  return `${size} ${unitCode}.`;
}

/**
 * Generate an xlsx file from order data
 * @returns Blob of the xlsx file
 */
export function generateOrderXlsx(order: OrderData): Blob {
  // Prepare data rows
  const rows = order.items.map((item) => {
    const parsed = parseDescription(item.descriptionSnapshot);
    const quantity = item.quantity ? parseFloat(item.quantity.toString()) : 0;
    const sizeWithUnit = formatSizeWithUnit(parsed.size, item.sizeUnitCode);

    return {
      Quantity: quantity,
      Size: sizeWithUnit,
      Material: parsed.material,
      Description: parsed.description,
    };
  });

  // Create worksheet
  const ws = utils.json_to_sheet(rows);

  // Set column widths
  const colWidths = [
    { wch: 10 }, // Quantity
    { wch: 15 }, // Size (wider to accommodate unit)
    { wch: 15 }, // Material
    { wch: 40 }, // Description
  ];
  ws["!cols"] = colWidths;

  // Create workbook
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, "Order");

  // Generate filename with date
  const date = new Date().toISOString().split("T")[0];
  const safeJobName = order.jobName.replace(/[^a-zA-Z0-9]/g, "-");
  const safeSupplierName = order.supplierName.replace(/[^a-zA-Z0-9]/g, "-");

  // Generate blob
  const wbout = write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([wbout], { type: "application/octet-stream" });
}

/**
 * Download xlsx file to user's machine
 */
export function downloadOrderXlsx(order: OrderData): string {
  const blob = generateOrderXlsx(order);
  const date = new Date().toISOString().split("T")[0];
  const safeJobName = order.jobName.replace(/[^a-zA-Z0-9]/g, "-");
  const safeSupplierName = order.supplierName.replace(/[^a-zA-Z0-9]/g, "-");
  const filename = `Order-${safeJobName}-${safeSupplierName}-${date}.xlsx`;

  // Create download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up URL after a delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}
