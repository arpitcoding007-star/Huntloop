/* eslint-disable */
// Product screens for the brochure: a fictional workspace on the isolated backend, both themes.
import { open, sql, person, signIn, B } from "../audit/pass-22/harness/lib.mjs";
const st = Date.now().toString(36), slug = "ledgerline" + st;
const p = await person(`alex@${slug}.test`);
const [o] = await sql(`insert into organizations(name,slug,onboarding_step,onboarding_completed_at) values('Ledgerline',$1,'done',now()) returning id`, [slug]);
await sql(`insert into memberships(org_id,user_id,role) values($1,$2,'owner')`, [o.id, p.id]);
await sql(`update profiles set full_name='Alex Rivera', role='founder' where id=$1`, [p.id]);
const [prod] = await sql(`insert into products(org_id,name,description) values($1,'Ledgerline Books','Bookkeeping for software companies') returning id`, [o.id]);
const [icp] = await sql(`insert into icps(org_id,name) values($1,'Funded software companies') returning id`, [o.id]);
await sql(`update icps set product_id=$2 where id=$1`, [icp.id, prod.id]).catch(() => {});
await sql(`update icps set active=true where id=$1`, [icp.id]).catch(() => sql(`update icps set is_active=true where id=$1`, [icp.id]).catch(() => {}));
const D = [["Northwind Systems", "northwind.example", "Infrastructure software", "hot", 92, "qualified", "Raised a Series B and opened two finance roles."], ["Vertex Labs", "vertexlabs.example", "Developer tools", "hot", 89, "contacted", "Announced a second office and is hiring a controller."], ["Halcyon Cloud", "halcyon.example", "Cloud infrastructure", "warm", 84, "replied", "Closed a Series A; no finance lead on the team page."], ["Pioneer Tech", "pioneertech.example", "Fintech", "warm", 78, "meeting", "Expanding into two new countries."], ["Summit Health", "summithealth.example", "Healthcare software", "watch", 61, "discovered", "Seed round; timing not established."], ["Brightwater Analytics", "brightwater.example", "Analytics", "warm", 74, "proposal", "Replaced its CFO last month."]];
const ids = [];
for (const [n, d, ind, pr, sc, stt, why] of D) {
  const [c] = await sql(`insert into companies(org_id,canonical_domain,name,industry,country,region,employee_count) values($1,$2,$3,$4,'United States','California',120) returning id`, [o.id, d, n, ind]).catch(() => sql(`insert into companies(org_id,canonical_domain,name,industry) values($1,$2,$3,$4) returning id`, [o.id, d, n, ind]));
  const [e1] = await sql(`insert into evidence(org_id,subject_type,subject_id,claim,kind,confidence,source_url,event_date) values($1,'company',$2,$3,'fact','high',$4,now()-interval '3 days') returning id`, [o.id, c.id, `Posted a Senior Accountant role`, `https://${d}/careers`]);
  await sql(`insert into company_triggers(org_id,company_id,trigger_type,event_date,evidence_id) values($1,$2,'hiring',now()-interval '3 days',$3)`, [o.id, c.id, e1.id]).catch((e) => console.log(e.message));
  const [op] = await sql(`insert into opportunities(org_id,company_id,icp_id,priority,priority_reason,status,why_now,why_now_written_at,why_this_company,identified_problem,outreach_angle,confidence,last_scored_at,estimated_value_cents,discovered_via) values($1,$2,$3,$4::text::opportunity_priority,$5,$6::text::opportunity_status,$7,now(),$8,$9,$10,'high',now(),$11,'discovery') returning id`, [o.id, c.id, icp.id, pr, why, stt, why, `${n} matches the profile on sector, size and stage.`, "Month-end close depends on one person while the company is adding entities.", "Offer to take over the close while the finance hire is in progress.", sc * 30000]);
  await sql(`insert into opportunity_scores(org_id,opportunity_id,model_version,score,icp_fit,problem_severity,evidence_strength,trigger_strength,trigger_freshness,buying_likelihood,product_relevance,decision_maker_accessibility,confidence,explanation) values($1,$2,'v1',$3,90,72,80,84,95,66,88,null,'high','Fits on sector and stage; the trigger is recent.')`, [o.id, op.id, sc]);
  await sql(`insert into evidence(org_id,subject_type,subject_id,claim,kind,confidence,source_url,event_date) values($1,'opportunity',$2,$3,'fact','high',$4,now()-interval '6 days'),($1,'opportunity',$2,'Finance is likely handled by a founder','inference','medium',null,null)`, [o.id, op.id, why, `https://${d}/news`]);
  const [pe] = await sql(`insert into people(org_id,company_id,first_name,last_name,title,is_decision_maker) values($1,$2,'Dana','Okonkwo','VP Finance',true) returning id`, [o.id, c.id]);
  await sql(`insert into contact_points(org_id,person_id,kind,value,verification_status,confidence) values($1,$2,'email',$3,'verified','high')`, [o.id, pe.id, `dana@${d}`]).catch(async (e) => { await sql(`insert into contact_points(org_id,person_id,kind,value) values($1,$2,'email',$3)`, [o.id, pe.id, `dana@${d}`]).catch((x) => console.log(x.message)); });
  ids.push(op.id);
}
await sql(`insert into campaigns(org_id,name,status,autonomy_level) values($1,'Finance hiring','active',1)`, [o.id]);
const [camp] = await sql(`select id from campaigns where org_id=$1`, [o.id]);
const [pp] = await sql(`select p.id from people p join opportunities q on q.company_id=p.company_id where q.id=$1`, [ids[0]]);
const ev = (await sql(`select id from evidence where org_id=$1 and subject_id=$2`, [o.id, ids[0]]))[0];
const cols = (await sql(`select column_name c from information_schema.columns where table_name='messages'`)).map((x) => x.c);
const to = ["to_email", "to_address", "recipient_address", "to_addr"].find((c) => cols.includes(c)); const evc = ["evidence_ids", "cited_evidence_ids"].find((c) => cols.includes(c));
await sql(`insert into messages(org_id,opportunity_id,direction,subject,body_text,ai_generated${to ? "," + to : ""}${evc ? "," + evc : ""}) values($1,$2,'outbound','The Senior Accountant role',$3,true${to ? ",'dana@northwind.example'" : ""}${evc ? `,array['${ev.id}']::uuid[]` : ""})`, [o.id, ids[0], "Hi Dana,\n\nI saw Northwind is hiring a Senior Accountant right after the Series B. Ledgerline can run the month-end close while you recruit.\n\nWould a short call next week help?"]).catch((e) => console.log("msg", e.message, cols.join()));
for (const [i, k] of [[1, "email_sent"], [2, "email_received"]]) await sql(`insert into activities(org_id,opportunity_id,kind,channel,direction,actor_type,occurred_at,summary,origin) values($1,$2,$3,'email',$4,'user',now()-interval '2 days',$5,'manual')`, [o.id, ids[i], k, i === 1 ? "outbound" : "inbound", i === 1 ? "First email sent" : "Asked for pricing"]).catch((e) => console.log(e.message));
await sql(`update opportunities set next_step='Send the proposal',next_step_due_at=now() where id=$1`, [ids[3]]);
// exchange
const buyer = await person(`buyer@by${st}.test`); const [bo] = await sql(`insert into organizations(name,slug,onboarding_step,onboarding_completed_at) values('Fieldnote',$1,'done',now()) returning id`, ["by" + st]); await sql(`insert into memberships(org_id,user_id,role) values($1,$2,'owner')`, [bo.id, buyer.id]);
const [cat] = await sql(`select id from exchange_categories where slug='accounting-tax'`);
await signIn; const [pf] = await sql(`insert into exchange_provider_profiles(org_id,name,claimed_at) values($1,'Ledgerline',now()) returning id`, [o.id]).catch(async (e) => { console.log(e.message, (await sql(`select column_name c from information_schema.columns where table_name='exchange_provider_profiles'`)).map(x=>x.c).join()); throw e; });
const [of] = await sql(`insert into exchange_offerings(provider_id,category_id,title,status,serves_global) values($1,$2,'Monthly bookkeeping for startups','active',true) returning id`, [pf.id, cat.id]);
const [n] = await sql(`insert into exchange_needs(org_id,created_by,category_id,summary,visibility,status) values($1,$2,$3,'Monthly bookkeeping for a 12-person startup',2,'open') returning id`, [bo.id, buyer.id, cat.id]);
await sql(`insert into exchange_matches(need_id,offering_id,score) values($1,$2,82)`, [n.id, of.id]);
for (const t of ["light", "dark"]) {
  const { b, ctx, page } = await open(); await b.close();
  const { chromium } = await import("playwright"); const br = await chromium.launch(); const c2 = await br.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2, colorScheme: t });
  const pg = await c2.newPage();
  const shot = async (who, s, name, path) => { await signIn(c2, who); await c2.addCookies([{ name: "hl-theme", value: t, url: B }]); await pg.goto(`${B}/${s}${path}`, { waitUntil: "networkidle" }); await pg.evaluate((x) => document.documentElement.setAttribute("data-theme", x), t); await pg.waitForTimeout(500); await pg.screenshot({ path: `brochure/shots/${name}-${t}.png` }); };
  await shot(p, slug, "s-opps", "/opportunities"); await shot(p, slug, "s-opp", "/opportunities/" + ids[0]); await shot(p, slug, "s-pipe", "/pipeline"); await shot(p, slug, "s-inbox", "/inbox"); await shot(p, slug, "s-needs", "/needs-you?filter=everyone"); await shot(p, slug, "s-dash", "/dashboard"); await shot(p, slug, "s-supplier", "/exchange/supplier"); await shot(buyer, "by" + st, "s-request", "/exchange/requests/" + n.id);
  await br.close();
}
