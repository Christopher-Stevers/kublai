"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { BoardTypesList } from "./_components/BoardTypesList";
import { BoardsList } from "./_components/BoardsList";

type Tab = "boardTypes" | "boards";

export default function AdminBoardsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("boardTypes");

  return (
    <div className="px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Boards Management</h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage board types and boards
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab("boardTypes")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "boardTypes"
              ? "border-b-2 border-primary text-primary"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Board Types
        </button>
        <button
          onClick={() => setActiveTab("boards")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "boards"
              ? "border-b-2 border-primary text-primary"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          Boards
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "boardTypes" && <BoardTypesList />}
      {activeTab === "boards" && <BoardsList />}
    </div>
  );
}

