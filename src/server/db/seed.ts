import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { env } from "~/env";

// Create database connection
const conn = postgres(env.DATABASE_URL);
const db = drizzle(conn);

/**
 * Seed script to populate the database with board types and vehicles
 *
 * Creates:
 * - Board types: Service Truck, Tow Truck, Trade Truck
 * - For each type: 3-8 vehicles
 * - Sample creatives
 *
 * Run with: pnpm db:seed
 */

// Board type definitions with prices
// Backfill is much cheaper (20-25% of slot price)
const boardTypeDefinitions = [
  {
    name: "Service Truck",
    description:
      "Professional service trucks perfect for mobile service operations and equipment transport.",
    imageUrl: "/images/service-truck-1.png",
    slotCostPerDay: 15000, // $150.00 per day in cents
    backfillCostPerDay: 3500, // $35.00 per day in cents (23% of slot)
    dimensionX: 1920, // pixels
    dimensionY: 1080, // pixels
  },
  {
    name: "Tow Truck",
    description:
      "Heavy-duty tow trucks designed for vehicle recovery and transportation services.",
    imageUrl: "/images/tow-truck-1.png",
    slotCostPerDay: 20000, // $200.00 per day in cents
    backfillCostPerDay: 5000, // $50.00 per day in cents (25% of slot)
    dimensionX: 1920, // pixels
    dimensionY: 1080, // pixels
  },
  {
    name: "Trade Truck",
    description:
      "Versatile trade trucks ideal for construction, delivery, and commercial applications.",
    imageUrl: "/images/trade-truck-1.png",
    slotCostPerDay: 18000, // $180.00 per day in cents
    backfillCostPerDay: 4000, // $40.00 per day in cents (22% of slot)
    dimensionX: 1920, // pixels
    dimensionY: 1080, // pixels
  },
];

// Vehicle name templates for each type
const vehicleNameTemplates = {
  "Service Truck": [
    "Service Truck Alpha",
    "Service Truck Beta",
    "Service Truck Gamma",
    "Service Truck Delta",
    "Service Truck Echo",
    "Service Truck Foxtrot",
    "Service Truck Golf",
    "Service Truck Hotel",
  ],
  "Tow Truck": [
    "Tow Truck Alpha",
    "Tow Truck Beta",
    "Tow Truck Gamma",
    "Tow Truck Delta",
    "Tow Truck Echo",
    "Tow Truck Foxtrot",
  ],
  "Trade Truck": [
    "Trade Truck Alpha",
    "Trade Truck Beta",
    "Trade Truck Gamma",
    "Trade Truck Delta",
    "Trade Truck Echo",
    "Trade Truck Foxtrot",
    "Trade Truck Golf",
  ],
};

// Note: Creatives are not seeded as they require userId, fileType, filePath, fileSize, and mimeType
// Creatives should be created through the application's upload functionality

/**
 * Generate a random number between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get a random vehicle name for a given type
 */
function getRandomVehicleName(type: string): string {
  const templates =
    vehicleNameTemplates[type as keyof typeof vehicleNameTemplates] ?? [];
  if (templates.length === 0) {
    return `${type} Vehicle ${randomInt(1, 100)}`;
  }
  return templates[randomInt(0, templates.length - 1)] ?? `${type} Vehicle`;
}

/**
 * Generate a vehicle description
 */
function generateVehicleDescription(type: string, name: string): string {
  const descriptions = [
    `A reliable ${type.toLowerCase()} perfect for professional operations.`,
    `This ${type.toLowerCase()} offers excellent performance and modern features.`,
    `Spacious and versatile ${type.toLowerCase()} with advanced capabilities.`,
    `Premium ${type.toLowerCase()} with professional-grade equipment.`,
    `Versatile ${type.toLowerCase()} ideal for commercial applications.`,
  ];
  return (
    descriptions[randomInt(0, descriptions.length - 1)] ??
    `A quality ${type.toLowerCase()}.`
  );
}

async function seed() {
  console.log("🌱 Starting database seed...");

  try {
    // Clear existing data in correct order (respecting foreign key constraints)
    console.log("🗑️  Clearing existing data...");
    // Use raw SQL to avoid import issues
    await db.execute(sql`DELETE FROM genghis_creative_for_order`);
    await db.execute(sql`DELETE FROM genghis_slot`);
    await db.execute(sql`DELETE FROM genghis_backfill`);
    await db.execute(sql`DELETE FROM genghis_order`);
    await db.execute(sql`DELETE FROM genghis_creative`);
    await db.execute(sql`DELETE FROM genghis_board`);
    await db.execute(sql`DELETE FROM genghis_board_type`);
    console.log("✅ Cleared all existing data");

    // Create board types
    console.log("📋 Creating board types...");
    const createdBoardTypes = [];
    for (const typeDef of boardTypeDefinitions) {
      const [result] = await db
        .execute(
          sql`INSERT INTO genghis_board_type (id, name, description, "imageUrl", "slotCostPerDay", "backfillCostPerDay", "dimensionX", "dimensionY") 
              VALUES (gen_random_uuid(), ${typeDef.name}, ${typeDef.description ?? null}, ${typeDef.imageUrl ?? null}, ${typeDef.slotCostPerDay}, ${typeDef.backfillCostPerDay}, ${typeDef.dimensionX ?? null}, ${typeDef.dimensionY ?? null}) 
              RETURNING id, name, description, "imageUrl", "slotCostPerDay", "backfillCostPerDay", "dimensionX", "dimensionY"`,
        )
        .then((rows) => rows);
      if (result) {
        createdBoardTypes.push({
          id: result.id as string,
          name: result.name as string,
          description: result.description as string | null,
          imageUrl: result.imageUrl as string | null,
          slotCostPerDay: result.slotCostPerDay as number,
          backfillCostPerDay: result.backfillCostPerDay as number,
          dimensionX: result.dimensionX as number | null,
          dimensionY: result.dimensionY as number | null,
        });
      }
    }

    console.log(`✅ Created ${createdBoardTypes.length} board types`);
    for (const type of createdBoardTypes) {
      console.log(
        `   • ${type.name}: Slot $${(type.slotCostPerDay / 100).toFixed(2)}/day, Backfill $${(type.backfillCostPerDay / 100).toFixed(2)}/day`,
      );
    }

    // Create vehicles for each board type
    const allBoards = [];

    for (const boardType of createdBoardTypes) {
      // Generate random number of vehicles (3-8)
      const vehicleCount = randomInt(3, 8);
      console.log(
        `🚗 Creating ${vehicleCount} vehicles for ${boardType.name}...`,
      );

      const vehicles = [];
      for (let i = 0; i < vehicleCount; i++) {
        const vehicleName = getRandomVehicleName(boardType.name);
        const vehicleDescription = generateVehicleDescription(
          boardType.name,
          vehicleName,
        );

        vehicles.push({
          boardTypeId: boardType.id,
          vehicleName,
          vehicleDescription,
        });
      }

      const createdVehicles = [];
      for (const vehicle of vehicles) {
        const [result] = await db
          .execute(
            sql`INSERT INTO genghis_board (id, "boardTypeId", "vehicleName", "vehicleDescription") 
                VALUES (gen_random_uuid(), ${vehicle.boardTypeId}, ${vehicle.vehicleName ?? null}, ${vehicle.vehicleDescription ?? null}) 
                RETURNING id, "boardTypeId", "vehicleName", "vehicleDescription"`,
          )
          .then((rows) => rows);
        if (result) {
          createdVehicles.push({
            id: result.id as string,
            boardTypeId: result.boardTypeId as string,
            vehicleName: result.vehicleName as string | null,
            vehicleDescription: result.vehicleDescription as string | null,
          });
        }
      }

      allBoards.push(...createdVehicles);
      console.log(
        `✅ Created ${createdVehicles.length} vehicles for ${boardType.name}`,
      );
    }

    // Skip creatives seeding - they require userId and actual file data
    // Creatives should be created through the application's upload functionality
    console.log("ℹ️  Skipping creatives (require user and file upload)");

    console.log(`\n🎉 Seed completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   - Board Types: ${createdBoardTypes.length}`);
    console.log(`   - Total Vehicles: ${allBoards.length}`);
    console.log(`   - Vehicles per type:`);
    for (const boardType of createdBoardTypes) {
      const count = allBoards.filter(
        (b) => b.boardTypeId === boardType.id,
      ).length;
      console.log(`     • ${boardType.name}: ${count} vehicles`);
    }
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
}

// Run seed when this script is executed directly
seed()
  .then(async () => {
    console.log("✅ Seed script completed");
    await conn.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Seed script failed:", error);
    await conn.end();
    process.exit(1);
  });

export { seed };
