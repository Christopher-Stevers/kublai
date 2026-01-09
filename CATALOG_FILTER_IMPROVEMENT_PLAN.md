# Catalog Filter Improvement Plan

## Current Issues Analysis

### Problems Identified

1. **Search and Category Browsing are Mutually Exclusive**
   - `getPartsByCategory` is only enabled when `!debouncedSearchQuery`
   - `searchParts` is only enabled when `!!debouncedSearchQuery`
   - Filters only work with search, not with category browsing
   - Users can't filter parts when browsing by category

2. **Incomplete Filter Support**
   - Material filter exists but only works with search query
   - PartType filter doesn't exist in UI or backend search
   - Size range filters (sizeMin/sizeMax) exist in backend but not in frontend
   - Category filter is separate from other filters (via sidebar, not integrated)

3. **Poor Filter UX**
   - Filters are hidden in a collapsible section
   - No visual indication of active filters
   - Can't see what filters are applied at a glance
   - No way to clear individual filters

4. **Backend Limitations**
   - `searchParts` doesn't support categoryId filter
   - `getPartsByCategory` doesn't support material, partType, or size filters
   - No endpoint to get distinct partTypes for filter dropdown
   - Size filtering doesn't account for different units (in vs mm)

## Solution Plan

### Phase 1: Backend - Unified Search/Filter Endpoint

**Goal**: Create a single, flexible endpoint that handles all filtering scenarios

#### 1.1 Enhance `searchParts` Procedure
**File**: `src/server/api/routers/catalogue.ts`

**Changes**:
- Add `categoryId` parameter (optional, nullable)
- Add `partType` parameter (optional)
- Keep existing `material`, `sizeMin`, `sizeMax` parameters
- Make `query` truly optional (can filter without search text)
- Support filtering by category even when no search query

**New Input Schema**:
```typescript
z.object({
  query: z.string().optional(), // Optional text search
  categoryId: z.string().uuid().nullable().optional(), // Filter by category
  partType: z.string().optional(), // Filter by part type
  material: z.string().optional(), // Filter by material
  sizeMin: z.number().optional(), // Minimum size
  sizeMax: z.number().optional(), // Maximum size
  sizeUnit: z.string().optional(), // Unit for size (in, mm, etc.)
})
```

#### 1.2 Add `getPartTypes` Procedure
**File**: `src/server/api/routers/catalogue.ts`

**Purpose**: Get distinct part types for filter dropdown (similar to `getMaterials`)

**Implementation**:
- Query distinct `partType` values from `partDefinitions`
- Filter by active parts and organization scope
- Return sorted list of part types

#### 1.3 Update Query Logic
- Combine category filtering with other filters
- Support filtering by category without requiring search query
- Ensure all filters work together (AND logic)
- Handle null/undefined values properly

### Phase 2: Frontend - Enhanced Filter UI

**Goal**: Create a user-friendly filter interface that's always accessible

#### 2.1 Unified Query Logic
**File**: `src/app/dashboard/catalogue/page.tsx`

**Changes**:
- Replace separate `getPartsByCategory` and `searchParts` calls with single `searchParts` call
- Always use `searchParts` with appropriate filters
- Pass `categoryId` to search when category is selected
- Remove the mutual exclusivity between search and category browsing

#### 2.2 Enhanced Filter Component
**File**: `src/app/dashboard/catalogue/page.tsx` (SearchAndFilters component)

**New Features**:
- **Part Type Filter**: Dropdown with distinct part types
- **Material Filter**: Keep existing, make it work without search
- **Size Range Filter**: 
  - Two inputs: "Min Size" and "Max Size"
  - Unit selector (in, mm, etc.) - optional, defaults to "in"
  - Clear individual size inputs
- **Category Integration**: Show selected category as a filter badge
- **Active Filter Badges**: Display all active filters as removable badges/chips
- **Filter Layout**: 
  - Always visible filter section (or prominent toggle)
  - Grid layout for filters on larger screens
  - Stacked on mobile

#### 2.3 Filter State Management
**New State Variables**:
```typescript
const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
const [searchQuery, setSearchQuery] = useState("");
const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null);
const [selectedPartType, setSelectedPartType] = useState<string | null>(null);
const [sizeMin, setSizeMin] = useState<number | undefined>(undefined);
const [sizeMax, setSizeMax] = useState<number | undefined>(undefined);
const [sizeUnit, setSizeUnit] = useState<string>("in"); // Default unit
```

#### 2.4 Active Filter Display
- Show active filters as badges/chips above or below the filter section
- Each badge shows filter name and value
- Click X on badge to remove that filter
- "Clear All" button when multiple filters are active

### Phase 3: UI/UX Improvements

#### 3.1 Filter Section Design
- **Desktop**: Horizontal filter bar with all filters visible
- **Mobile**: Collapsible filter panel with clear organization
- **Visual Hierarchy**: 
  - Search bar at top
  - Filters below in organized sections
  - Active filter badges prominently displayed

#### 3.2 Filter Labels and Helpers
- Clear labels for each filter
- Placeholder text for size inputs (e.g., "0.5" for half inch)
- Unit indicator next to size inputs
- Tooltips or help text for complex filters

#### 3.3 Results Feedback
- Show count of filtered results
- "X results found" message
- Clear indication when filters are active vs. showing all parts

### Phase 4: Technical Implementation Details

#### 4.1 Backend Query Optimization
- Ensure proper indexing on filterable columns
- Use efficient WHERE clause construction
- Consider query performance with multiple filters

#### 4.2 Size Filter Logic
- Handle different units (convert or filter by unit)
- For MVP: Filter by sizeNominal with unit context
- Future: Unit conversion for cross-unit filtering

#### 4.3 Error Handling
- Validate filter inputs
- Handle edge cases (empty strings, invalid numbers)
- Provide helpful error messages

## Implementation Steps

### Step 1: Backend Updates
1. Update `searchParts` input schema to include all filters
2. Add `categoryId` filtering logic
3. Add `partType` filtering logic
4. Create `getPartTypes` procedure
5. Test all filter combinations

### Step 2: Frontend State & Logic
1. Update state management for all filters
2. Replace dual query logic with single unified query
3. Update filter component props and handlers
4. Implement active filter badge display

### Step 3: UI Components
1. Add Part Type dropdown
2. Add Size range inputs with unit selector
3. Create filter badge/chip component
4. Update filter layout and styling
5. Add responsive design for mobile

### Step 4: Testing & Refinement
1. Test all filter combinations
2. Test with and without search query
3. Test category + filter combinations
4. Verify filter clearing works correctly
5. Test on mobile devices

## Files to Modify

### Backend
- `src/server/api/routers/catalogue.ts`
  - Update `searchParts` procedure
  - Add `getPartTypes` procedure

### Frontend
- `src/app/dashboard/catalogue/page.tsx`
  - Update state management
  - Replace query logic
  - Enhance SearchAndFilters component
  - Add filter badge display

## Success Criteria

1. ✅ Users can filter by category AND other filters simultaneously
2. ✅ Users can filter without entering a search query
3. ✅ All filter types are available: category, partType, material, size
4. ✅ Active filters are clearly visible and removable
5. ✅ Filters work together (AND logic)
6. ✅ Clear visual feedback on filtered results
7. ✅ Mobile-friendly filter interface

## Future Enhancements (Out of Scope)

- Unit conversion for size filtering
- Saved filter presets
- Filter by multiple materials/partTypes (OR logic)
- Advanced size filtering with unit conversion
- Filter by price range (when pricing is added)
- Sort options (by name, size, material, etc.)

