import openpyxl
import sys

file_path = r"D:\Chris\Startups\kublai\src\server\api\routers\Material Catalogue-1.xlsx"

print("=" * 70)
print(f"EXCEL FILE ANALYSIS: {file_path}")
print("=" * 70)

# Load the workbook
wb = openpyxl.load_workbook(file_path)
print(f"\nTotal sheets: {len(wb.sheetnames)}")
print(f"Sheet names: {wb.sheetnames}")

for sheet_name in wb.sheetnames:
    print("\n" + "=" * 70)
    print(f"SHEET: {sheet_name}")
    print("=" * 70)
    
    ws = wb[sheet_name]
    
    # Get basic info
    max_row = ws.max_row
    max_col = ws.max_column
    print(f"Dimensions: {max_row} rows x {max_col} columns")
    
    # Get headers (first row)
    headers = []
    for col in range(1, min(max_col + 1, 20)):  # Limit to first 20 columns
        cell_value = ws.cell(row=1, column=col).value
        headers.append(cell_value if cell_value else f"Column_{col}")
    
    print(f"\nColumn Headers ({len(headers)} columns):")
    for i, header in enumerate(headers, 1):
        print(f"  {i}. {header}")
    
    # Show sample rows (next 5 rows)
    print(f"\nSample Data (first 5 data rows):")
    for row_num in range(2, min(max_row + 1, 7)):
        row_data = []
        for col in range(1, min(max_col + 1, 20)):
            cell_value = ws.cell(row=row_num, column=col).value
            if cell_value:
                row_data.append(f"{headers[col-1]}: {str(cell_value)[:50]}")
        if row_data:
            print(f"  Row {row_num-1}: {', '.join(row_data[:5])}")  # Show first 5 fields
    
    if max_row > 6:
        print(f"  ... ({max_row - 6} more rows)")

print("\n" + "=" * 70)
print("ANALYSIS COMPLETE")
print("=" * 70)
