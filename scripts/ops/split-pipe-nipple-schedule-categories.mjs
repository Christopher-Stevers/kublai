import "dotenv/config";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  const result = await sql.begin(apply ? "" : "read only", async (tx) => {
    const [job] =
      await tx`select "organizationId" org from kublai_job where id='0391aed4-7773-47ec-9141-09df373ec008'`;
    if (!job) throw Error("Alma missing");
    const rows =
      await tx`select p.id,p."displayName",p."categoryId",c.name category,m.name material,s.nominal,(select a."valueText" from kublai_part_attribute a where a."partDefinitionId"=p.id and a.key='pipe_schedule') schedule from kublai_part_definition p left join kublai_category c on c.id=p."categoryId" left join kublai_material m on m.id=p."materialId" left join kublai_size s on s.id=p."sizeId" where p."organizationId"=${job.org}`;
    const changes = [];
    for (const p of rows) {
      const nipple = /\bnipple\b/i.test(p.displayName);
      const pipe =
        !nipple && ["Pipe", "Sch 40 Pipe", "Sch 80 Pipe"].includes(p.category);
      if (!nipple && !pipe) continue;
      const schedules = new Set();
      if (p.schedule) {
        const m = /^(40|80)S?$/i.exec(p.schedule);
        if (m) schedules.add(m[1]);
        else continue;
      }
      for (const m of `${p.displayName} ${p.material}`.matchAll(
        /\bSCH(?:EDULE)?\.?\s*(40|80)S?\b/gi,
      ))
        schedules.add(m[1]);
      // Carbon steel standard weight equals Schedule 40 only through NPS 10.
      if (
        !schedules.size &&
        pipe &&
        p.material === "Carbon Steel" &&
        /\bSTD\b/.test(p.displayName) &&
        Number(p.nominal) > 0 &&
        Number(p.nominal) <= 10
      )
        schedules.add("40");
      if (schedules.size > 1)
        throw Error("Conflicting schedules: " + p.displayName);
      if (!schedules.size) continue;
      const category = `Sch ${[...schedules][0]} ${nipple ? "Nipples" : "Pipe"}`;
      if (p.category !== category) changes.push({ ...p, target: category });
    }
    const counts = {};
    for (const p of changes) counts[p.target] = (counts[p.target] || 0) + 1;
    if (!apply) return { wouldMove: changes.length, counts };
    fs.mkdirSync("state-backups", { recursive: true });
    const backup = `state-backups/schedule-categories-${Date.now()}.json`;
    fs.writeFileSync(
      backup,
      JSON.stringify({ organizationId: job.org, changes }, null, 2),
    );
    for (const name of Object.keys(counts)) {
      let [cat] =
        await tx`select id from kublai_category where "organizationId"=${job.org} and name=${name}`;
      if (!cat)
        [cat] =
          await tx`insert into kublai_category (id,"organizationId",name,"sortOrder") values (${randomUUID()},${job.org},${name},1) returning id`;
      const ids = changes.filter((p) => p.target === name).map((p) => p.id);
      const updated =
        await tx`update kublai_part_definition set "categoryId"=${cat.id} where "organizationId"=${job.org} and id in ${tx(ids)} returning id`;
      if (updated.length !== ids.length) throw Error("Update count mismatch");
    }
    return { moved: changes.length, counts, backup };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end();
}
