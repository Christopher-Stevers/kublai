import { Webhook } from 'svix';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
// Run inside the deployed container; never prints signing or database credentials.
const base = process.env.FOREMANHQ_PUBLIC_URL;
if (base !== 'https://aws.foremanhq.ca') throw new Error('This smoke test is restricted to the AWS acceptance deployment');
const id = `user_aws_smoke_${randomUUID()}`;
const db = postgres(process.env.DATABASE_URL, {max:1});
const webhook = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
async function send(type,data){
 const payload=JSON.stringify({type,data,object:'event'});
 const msgId=`msg_${randomUUID()}`,timestamp=new Date();
 const res=await fetch(`${base}/api/webhooks/clerk`,{method:'POST',headers:{'content-type':'application/json','svix-id':msgId,'svix-timestamp':String(Math.floor(timestamp.getTime()/1000)),'svix-signature':webhook.sign(msgId,timestamp,payload)},body:payload});
 if(res.status!==200)throw new Error(`Webhook ${type} returned ${res.status}`);
}
try {
 const unsigned=await fetch(`${base}/api/webhooks/clerk`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 if(unsigned.status!==400)throw new Error('Unsigned webhook was not rejected');
 await send('user.created',{id,email_addresses:[{email_address:'aws-smoke@example.invalid'}],first_name:'AWS',last_name:'Smoke',image_url:null});
 const rows=await db`select id from kublai_user where id=${id}`;
 if(rows.length!==1)throw new Error('User was not persisted');
 await send('user.updated',{id,email_addresses:[{email_address:'aws-smoke@example.invalid'}],first_name:'AWS',last_name:'Updated',image_url:null});
 const changed=await db`select name from kublai_user where id=${id}`;
 if(changed[0]?.name!=='AWS Updated')throw new Error('User update was not persisted');
 console.log('Clerk signed create/update verified; unsigned request rejected.');
} finally {
 try {await send('user.deleted',{id});const rows=await db`select id from kublai_user where id=${id}`;if(rows.length)throw new Error('Test user deletion failed');console.log('Signed delete verified; synthetic test user removed.');} finally {await db.end();}
}
