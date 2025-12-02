# Admin Dashboard - Boards & Board Types Management Plan

## Overview
This plan outlines the implementation of an admin dashboard feature that allows admin users to add, remove, and edit board types and boards, with proper validation to prevent modifications to allocated resources.

## Current State Analysis

### Database Schema
- **Board Types** (`board_type` table):
  - Fields: `id`, `name`, `description`, `imageUrl`, `slotCostPerDay`, `backfillCostPerDay`
  - **Missing**: `dimensionX`, `dimensionY` (need to add)
  
- **Boards** (`board` table):
  - Fields: `id`, `boardTypeId`, `vehicleName`, `vehicleDescription`
  
- **Allocation Relationships**:
  - **Slots**: `slots` table links `boardId` → `boards.id` and `orderId` → `orders.id`
  - **Backfills**: `backfills` table links `orderId` → `orders.id` (not directly to boards, but orders contain slots that reference boards)

### Current Admin Dashboard
- Located at `/admin/dashboard`
- Currently handles: Order approval, Creative approval
- Uses tRPC with `adminRouter` for backend operations

## Implementation Plan

### Phase 1: Database Schema Updates

#### 1.1 Add Dimensions to Board Types
- Add `dimensionX` (integer, in pixels/cm) and `dimensionY` (integer, in pixels/cm) fields to `boardTypes` table
- Create migration file
- Update TypeScript schema definitions

**Migration Steps:**
```sql
ALTER TABLE "genghis_board_type" 
  ADD COLUMN "dimensionX" integer,
  ADD COLUMN "dimensionY" integer;
```

### Phase 2: Backend API (tRPC Router)

#### 2.1 Board Types Management Endpoints

**Location**: `src/server/api/routers/admin.ts`

**New Procedures:**

1. **`getBoardTypes`** (query)
   - Returns all board types with their boards count
   - Includes allocation status (whether any boards of this type are allocated)

2. **`getBoardType`** (query)
   - Input: `boardTypeId: string`
   - Returns single board type with details

3. **`createBoardType`** (mutation)
   - Input: `{ name, description, imageUrl, slotCostPerDay, backfillCostPerDay, dimensionX, dimensionY }`
   - Creates new board type
   - Validation: Ensure name is unique, dimensions are positive integers

4. **`updateBoardType`** (mutation)
   - Input: `{ boardTypeId, name?, description?, imageUrl?, slotCostPerDay?, backfillCostPerDay?, dimensionX?, dimensionY? }`
   - Updates board type
   - **Validation**: Check if any boards of this type are allocated (have slots or are in orders with backfills)
   - If allocated, prevent modification

5. **`deleteBoardType`** (mutation)
   - Input: `{ boardTypeId: string }`
   - Deletes board type
   - **Validation**: 
     - Check if any boards exist with this `boardTypeId`
     - If boards exist, prevent deletion with error message
     - If no boards exist, allow deletion

#### 2.2 Boards Management Endpoints

1. **`getBoards`** (query)
   - Input: `{ boardTypeId?: string, page?: number, pageSize?: number }`
   - Returns boards with their board type info
   - Includes allocation status (whether board has slots)

2. **`getBoard`** (query)
   - Input: `{ boardId: string }`
   - Returns single board with details and allocation status

3. **`createBoard`** (mutation)
   - Input: `{ boardTypeId, vehicleName?, vehicleDescription? }`
   - Creates new board
   - Validation: Ensure `boardTypeId` exists

4. **`updateBoard`** (mutation)
   - Input: `{ boardId, boardTypeId?, vehicleName?, vehicleDescription? }`
   - Updates board
   - **Validation**: 
     - Check if board has any slots (allocated)
     - If allocated, prevent modification
     - If changing `boardTypeId`, ensure new board type exists

5. **`deleteBoard`** (mutation)
   - Input: `{ boardId: string }`
   - Deletes board
   - **Validation**: 
     - Check if board has any slots
     - If has slots, prevent deletion with error message
     - If no slots, allow deletion

#### 2.3 Helper Functions for Allocation Checking

**Functions to create:**

1. **`isBoardTypeAllocated(boardTypeId)`**
   - Checks if any boards of this type have slots
   - Returns boolean

2. **`isBoardAllocated(boardId)`**
   - Checks if board has any slots
   - Returns boolean

3. **`getBoardTypeBoardsCount(boardTypeId)`**
   - Returns count of boards using this board type
   - Used for deletion validation

### Phase 3: Frontend UI Components

#### 3.1 New Admin Page: Board Management

**Location**: `src/app/admin/boards/page.tsx`

**Features:**
- Tabbed interface with two tabs:
  - "Board Types" tab
  - "Boards" tab

#### 3.2 Board Types Tab

**Components:**
- **BoardTypesList**: Displays all board types in a table/card grid
  - Shows: Name, Description, Dimensions (X × Y), Slot Cost, Backfill Cost, Image Preview
  - Shows allocation status (badge: "Has Allocated Boards" or "No Allocations")
  - Actions: Edit, Delete (disabled if allocated)

- **BoardTypeForm** (Modal/Dialog):
  - Create/Edit form
  - Fields:
    - Name (required, text input)
    - Description (optional, textarea)
    - Image URL (optional, text input with preview)
    - Dimension X (required, number input)
    - Dimension Y (required, number input)
    - Slot Cost Per Day (required, number input in cents, display as dollars)
    - Backfill Cost Per Day (required, number input in cents, display as dollars)
  - Validation: Show errors for invalid inputs
  - Submit button: "Create Board Type" or "Update Board Type"

- **DeleteBoardTypeDialog**:
  - Confirmation dialog
  - Shows warning if board type has boards
  - Displays count of boards using this type
  - Error message if deletion is attempted on allocated board type

#### 3.3 Boards Tab

**Components:**
- **BoardsList**: Displays all boards in a table
  - Shows: Vehicle Name, Board Type, Description, Allocation Status
  - Filter by Board Type (dropdown)
  - Pagination
  - Actions: Edit, Delete (disabled if allocated)

- **BoardForm** (Modal/Dialog):
  - Create/Edit form
  - Fields:
    - Board Type (required, dropdown/select)
    - Vehicle Name (optional, text input)
    - Vehicle Description (optional, textarea)
  - Validation
  - Submit button: "Create Board" or "Update Board"

- **DeleteBoardDialog**:
  - Confirmation dialog
  - Shows warning if board has slots
  - Error message if deletion is attempted on allocated board

#### 3.4 UI/UX Considerations

- **Allocation Indicators**:
  - Use badges/icons to show allocation status
  - Red badge: "Allocated - Cannot Modify"
  - Green badge: "Available - Can Modify"
  
- **Error Handling**:
  - Toast notifications for success/error messages
  - Inline form validation
  - Clear error messages when operations fail

- **Loading States**:
  - Skeleton loaders while fetching data
  - Disable buttons during mutations

- **Responsive Design**:
  - Mobile-friendly tables/cards
  - Responsive modals

### Phase 4: Navigation Updates

#### 4.1 Admin Dashboard Navigation
- Add link to "Boards Management" in admin dashboard header/navigation
- Update `src/app/_components/Header.tsx` or create admin-specific navigation

### Phase 5: Validation Logic Details

#### 5.1 Board Type Allocation Check
A board type is considered "allocated" if:
- Any board of this type has slots (in `slots` table where `boardId` references a board with this `boardTypeId`)

**Query:**
```sql
SELECT COUNT(*) > 0 
FROM slots s
INNER JOIN boards b ON s.boardId = b.id
WHERE b.boardTypeId = ?
```

#### 5.2 Board Allocation Check
A board is considered "allocated" if:
- The board has any slots (in `slots` table where `boardId` = board.id)

**Query:**
```sql
SELECT COUNT(*) > 0 
FROM slots
WHERE boardId = ?
```

#### 5.3 Board Type Deletion Check
A board type can be deleted if:
- No boards exist with this `boardTypeId`

**Query:**
```sql
SELECT COUNT(*) 
FROM boards
WHERE boardTypeId = ?
```

#### 5.4 Board Deletion Check
A board can be deleted if:
- No slots exist for this board

**Query:**
```sql
SELECT COUNT(*) 
FROM slots
WHERE boardId = ?
```

### Phase 6: Testing Considerations

1. **Unit Tests**:
   - Test allocation checking functions
   - Test validation logic

2. **Integration Tests**:
   - Test CRUD operations for board types
   - Test CRUD operations for boards
   - Test that allocated resources cannot be modified/deleted

3. **Manual Testing**:
   - Create board type → Create boards → Allocate slots → Try to modify/delete
   - Verify error messages are clear
   - Test edge cases (empty states, large lists, etc.)

## Implementation Order

1. ✅ Database migration: Add dimensions to board types
2. ✅ Backend: Create helper functions for allocation checking
3. ✅ Backend: Implement board types CRUD endpoints
4. ✅ Backend: Implement boards CRUD endpoints
5. ✅ Frontend: Create Board Types tab UI
6. ✅ Frontend: Create Boards tab UI
7. ✅ Frontend: Add navigation link
8. ✅ Testing: Manual and automated tests

## Files to Create/Modify

### New Files:
- `src/app/admin/boards/page.tsx` - Main board management page
- `src/app/admin/boards/_components/BoardTypesList.tsx`
- `src/app/admin/boards/_components/BoardTypeForm.tsx`
- `src/app/admin/boards/_components/BoardsList.tsx`
- `src/app/admin/boards/_components/BoardForm.tsx`
- `drizzle/[timestamp]_add_dimensions_to_board_type.sql` - Migration file

### Modified Files:
- `src/server/db/schema.ts` - Add dimensionX, dimensionY to boardTypes
- `src/server/api/routers/admin.ts` - Add new procedures
- `src/app/_components/Header.tsx` - Add navigation link (if needed)

## Notes

- **Backfill Allocation**: While backfills don't directly reference boards, they reference orders. Orders contain slots that reference boards. For simplicity, we'll only check slots for allocation status. If needed, we can extend this to check if a board type's boards are in orders that have backfills.

- **Dimensions Units**: The plan assumes dimensions are stored as integers. Units (pixels, cm, inches) should be documented and consistent. Consider adding a `dimensionUnit` field if multiple units are needed.

- **Image Upload**: Currently using `imageUrl` (text field). Consider implementing file upload functionality in the future.

- **Cost Fields**: Currently stored in cents. UI should convert to dollars for display, but store in cents.

