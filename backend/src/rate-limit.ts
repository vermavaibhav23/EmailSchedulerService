// Atomic sender counters and spacing shared by every worker. Redis TIME prevents clock skew.
export const gateScript = `
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local hour=math.floor(now/3600000)
local saved=tonumber(redis.call('HGET',KEYS[1],'hour') or '-1')
local count=tonumber(redis.call('HGET',KEYS[1],'count') or '0')
if saved~=hour then count=0 end
local cap=tonumber(ARGV[1])
if count>=cap then return {(hour+1)*3600000,1,hour,count} end
local next=tonumber(redis.call('HGET',KEYS[1],'next') or '0')
if next>now then return {next,0,hour,count} end
count=count+1
redis.call('HSET',KEYS[1],'hour',hour,'count',count,'next',now+tonumber(ARGV[2]))
redis.call('PEXPIRE',KEYS[1],7200000)
return {0,0,hour,count}
`;
