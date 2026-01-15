# Dashboard Restructure Plan

## Overview
Restructure the dashboard navigation flow to be:
1. **Main Dashboard** (`/dashboard`) → List all jobs
2. **Job Page** (`/dashboard/jobs/[jobId]`) → List material lists for that job
3. **Material List Page** (`/dashboard/material-lists/[id]`) → Manage individual material list (already exists)

## Current State
- `/dashboard` currently shows material lists for the "current job" (auto-created if none exists)
- Uses `job.getCurrentJob` to get/auto-create a job
- Uses `materialList.listMaterialLists` with current job ID

## Changes Required

### 1. Backend API Changes

#### 1.1 Enhance `job.listJobs` API
**File:** `src/server/api/routers/job.ts`

Add material list counts to each job in the `listJobs` query:
- Count of material lists per job
- Optionally: total items across all material lists for the job
- Optionally: total material cost across all material lists

**Current return structure:**
```typescript
{
  id: string;
  name: string;
  locationId: string | null;
  status: string;
  createdAt: Date;
  location: { id: string; name: string } | null;
  foreman: { id: string; name: string } | null;
}
```

**Enhanced return structure:**
```typescript
{
  id: string;
  name: string;
  locationId: string | null;
  status: string;
  createdAt: Date;
  location: { id: string; name: string } | null;
  foreman: { id: string; name: string } | null;
  materialListCount: number; // NEW
  // Optional: totalItems, totalCost
}
```

### 2. Frontend Page Changes

#### 2.1 Update `/dashboard/page.tsx`
**File:** `src/app/dashboard/page.tsx`

**Changes:**
- Remove `getCurrentJob` query and auto-create logic
- Remove `listMaterialLists` query
- Add `job.listJobs` query to fetch all jobs
- Display jobs in a card/grid layout
- Each job card should:
  - Show job name, location, foreman, status
  - Show material list count
  - Be clickable to navigate to `/dashboard/jobs/[jobId]`
- Add "New Job" button (if job creation is needed)

**UI Structure:**
```
┌─────────────────────────────────────┐
│ Dashboard                            │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐│
│ │ Job 1   │  │ Job 2   │  │ Job 3   ││
│ │ Location│  │ Location│  │ Location││
│ │ 3 lists │  │ 1 list  │  │ 0 lists ││
│ └─────────┘  └─────────┘  └─────────┘│
└─────────────────────────────────────┘
```

#### 2.2 Create `/dashboard/jobs/[jobId]/page.tsx`
**File:** `src/app/dashboard/jobs/[jobId]/page.tsx` (NEW)

**Purpose:** Show material lists for a specific job

**Features:**
- Fetch job details using `job.getJob` or `job.listJobs` filtered by ID
- Fetch material lists using `materialList.listMaterialLists` with `jobId`
- Display job info header (name, location, foreman, status)
- Display list of material lists (similar to current dashboard page)
- "New Material List" button
- Auto-create first material list if job has none (optional)
- Back button to return to `/dashboard`

**UI Structure:**
```
┌─────────────────────────────────────┐
│ ← Back to Jobs                       │
│                                      │
│ Job: [Job Name]                      │
│ Location: [Location Name]            │
│                                      │
│ Material Lists          [+ New List] │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐│
│ │ List 1  │  │ List 2  │  │ List 3  ││
│ │ 5 items │  │ 3 items │  │ 8 items ││
│ │ $1,234  │  │ $567    │  │ $2,345  ││
│ └─────────┘  └─────────┘  └─────────┘│
└─────────────────────────────────────┘
```

#### 2.3 Keep `/dashboard/material-lists/[id]/page.tsx`
**File:** `src/app/dashboard/material-lists/[id]/page.tsx`

**Changes:**
- Update "Back" button to go to `/dashboard/jobs/[jobId]` instead of `/dashboard/material-lists`
- Extract jobId from material list data to construct back URL

### 3. Navigation Updates

#### 3.1 Update Header Navigation
**File:** `src/app/_components/Header.tsx`

- Keep "Dashboard" link pointing to `/dashboard`
- Remove or update any direct links to material lists page
- Consider adding breadcrumbs for better navigation

#### 3.2 Update JobSelector Component
**File:** `src/components/JobSelector.tsx`

- May need to update if it's used in the header
- Consider if "current job" concept is still needed or if we navigate via URL

### 4. Component Reuse

#### 4.1 Create Reusable Job Card Component
**File:** `src/components/jobs/JobCard.tsx` (NEW - optional)

Extract job card UI into reusable component for consistency.

#### 4.2 Reuse Material List Card Component
The material list cards from current dashboard can be reused in the job page.

### 5. Routing Structure

```
/dashboard
  ├── / (page.tsx) → List all jobs
  ├── /jobs/[jobId] (page.tsx) → List material lists for job
  └── /material-lists/[id] (page.tsx) → Manage material list (existing)
```

## Implementation Order

1. ✅ **Enhance backend API** - Add material list counts to `job.listJobs`
2. ✅ **Create job detail page** - `/dashboard/jobs/[jobId]/page.tsx`
3. ✅ **Update main dashboard** - Change to list jobs
4. ✅ **Update material list page** - Fix back button navigation
5. ✅ **Update navigation components** - Header, breadcrumbs, etc.
6. ✅ **Test navigation flow** - Ensure all links work correctly

## Considerations

### Auto-Create Logic
- **Current:** Auto-creates job if none exists, then auto-creates material list
- **New:** 
  - Option A: Remove auto-create entirely, require manual creation
  - Option B: Auto-create first material list when viewing a job with no lists
  - **Recommendation:** Option B for better UX

### Current Job Concept
- Currently uses `user.currentJobId` to track "current job"
- With new structure, job is selected via URL (`/dashboard/jobs/[jobId]`)
- May still need `currentJobId` for:
  - JobSelector component in header
  - Quick access to "current" job
  - **Decision needed:** Keep current job concept or remove it?

### Empty States
- Dashboard with no jobs: Show "Create your first job" message
- Job with no material lists: Show "Create your first material list" message

## Testing Checklist

- [ ] Dashboard shows all jobs
- [ ] Clicking a job navigates to job detail page
- [ ] Job detail page shows material lists for that job
- [ ] Clicking a material list navigates to material list detail
- [ ] Back buttons work correctly
- [ ] Creating new material list works from job page
- [ ] Creating new job works (if implemented)
- [ ] Empty states display correctly
- [ ] Mobile navigation works
- [ ] Breadcrumbs work (if added)


