#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var tele = require("../index");
var argv = require("optimist")
  .usage("Usage: $0 --id id.json --seeds seeds.json")
  .default("id", "./id.json")
  .default("v", "./debug.log")
  .argv;

// write all debug output to a log
var vlog = fs.createWriteStream(path.join(process.cwd(),argv.v), {flags:"a"});
vlog.write("starting with "+JSON.stringify(argv)+"\n");
tele.debug(function(){
  var args = arguments;
  args = Object.keys(arguments).map(function(k){return args[k]});
  args.unshift(new Date().toISOString());
  vlog.write(args.join(" ")+"\n");
});

// set up our readline interface
rl = require("readline").createInterface(process.stdin, process.stdout, null);
function log(){
  // hacks!
  rl.output.write("\x1b[2K\r");
  var args = arguments;
  args = Object.keys(arguments).map(function(k){return args[k]});
  console.log(args.join(" "));
  rl._refreshLine()
}
process.stdin.on("keypress", function(s, key){
  if(key && key.ctrl && key.name == "c") process.exit(0);
  if(key && key.ctrl && key.name == "d") process.exit(0);
})

// load or generate our crypto id
var id;
var idfile = path.join(process.cwd(),argv.id);
if(fs.existsSync(idfile))
{
  id = require(idfile);
  init();
}else{
  tele.genkey(function(err, key){
    if(err) return cmds.quit(err);
    id = key;
    rl.question('nickname? ', function(nick) {
      id.nick = nick;
      fs.writeFileSync(idfile, JSON.stringify(id, null, 4));
      init();
    });    
  });
}

var groups = {
  ids:{},
  get:function(id){
    if(groups.ids[id]) return groups.ids[id];
    var group = groups.ids[id] = {id:id,members:{}};
    group.add = function(chan){
      chan.group = group;
      group.members[chan.hashname] = chan;
    };
    return group;
  }
};

var me;
function init()
{
  rl.setPrompt(id.nick+"> ");
  rl.prompt();

  me = tele.hashname(id);
  if(argv.seeds) me.addSeeds(argv.seeds);

  me.online(function(err){
    log((err?err:"online as "+me.hashname));
  });

  me.listen("message", function(err, arg, chan, cb){
    messageInit(false, arg, chan, cb);
    chan.send({js:{nick:id.nick}});
  });
  me.listen("group", function(err, arg, chan, cb){
    if(!arg.js.group) return log("missing group error from",chan.hashname);
    groups.get(arg.js.group).add(chan);
    groupInit(arg, chan);
    chan.send({js:{nick:id.nick}});
    cb();
  });
  me.listen("members", function(err, arg, chan, cb){
    // send members in chunks
    cb();
    var group = groups.get(arg.js.group);
    var mlist = Object.keys(group.members);
    mlist.push(me.hashname); // always include yourself
    while(mlist.length > 0)
    {
      var chunk = mlist.slice(0, 10);
      mlist = mlist.slice(10);
      chan.send({js:{members:chunk}});
      if(mlist.length == 0) chan.end();
    }
  });
}

// intitial incoming or answer to outgoing message channel
var nicks = {};
function messageInit(err, arg, chan, cb)
{
  if(err) return log("message handshake err",err);
  chan.nick = (arg.js.nick) ? arg.js.nick : chan.hashname.substr(0,6);
  nicks[chan.nick] = chan;
  log("m["+chan.nick+"] connected");
  chan.callback = function(err, arg, chan, cbMessage){
    if(arg && arg.js.message) log("m["+chan.nick+"]:",arg.js.message);
    if(err){
      log("m["+chan.nick+"] disconnected",err);
      delete nicks[chan.nick];
    }
    cbMessage();
  };
  cb();
}

// configure a channel for group mode
function groupInit(arg, chan)
{
  chan.nick = (arg.js.nick) ? arg.js.nick : chan.hashname.substr(0,6);
  log("g["+chan.group.id+"/"+chan.nick+"] joined");
  chan.callback = function(err, arg, chan, cbMessage){
    if(arg && arg.js.message) log("g["+chan.group.id+"/"+chan.nick+"]: "+arg.js.message);
    if(err)
    {
      log("g["+chan.group.id+"/"+chan.nick+"] left",err);
      delete chan.group.members[chan.hashname];
    }
    cbMessage();
  };
}

// our chat handler
rl.on('line', function(line) {
  var parts = line.split(" ");
  var cmd = parts.shift();
  if(cmds[cmd]) cmds[cmd](parts);
  else log("I don't know how to "+cmd);
  rl.prompt();
});

var cmds = {};
cmds.help = cmds["?"] = function(arg){
  log("'quit|done'","exit the app");
  log("'whoami'","your info");
  log("'seek hashname'","look for that hashname in the DHT");  
  log("'ping hashname'","try to connect to and get response from that hashname");
  log("'a|all'","show all connected hashnames");
  log("'add hashname'","add a hashname to send messages to");
  log("'m|message nick'","send a message to the nickname");
  log("'w|who'","which nicknames are attached");
  log("'join group'","create a group that others can join");
  log("'join group hashname'","join a group that exists via that hashname");
  log("'gw|gwho group'","see who's in the group");
  log("'gm group'","send a message to the group");
}
cmds.quit = cmds.exit = function(arg){
  if(arg[0]) log(arg[0]);
  process.exit();
}
cmds.whoami = function(){
  log("I am",id.nick,me.address);
}
cmds["42"] = function(){
  log("I hash, therefore I am.");
}
cmds.add = function(arg){
  var host = me.whois(arg[0]);
  if(!host) return log("invalid hashname",arg[0]);
  log("adding",host.hashname);
  host.start("message", {js:{nick:id.nick}}, messageInit);  
}
cmds.message = cmds.m = function(arg){
  if(!nicks[arg[0]]) return log("unknown recipient",arg[0]);
  nicks[arg.shift()].send({js:{message:arg.join(" ")}});
}
cmds.who = cmds.w = function()
{
  Object.keys(nicks).forEach(function(nick){
    log(nick,nicks[nick].hashname);
  });
}
cmds.all = cmds.a = function()
{
  Object.keys(me.lines).forEach(function(line){
    var hn = me.lines[line];
    log(hn.address,Object.keys(hn.chans).length);
  });
}
cmds.gw = cmds.gwho = function(arg){
  var group = groups.get(arg.shift());
  Object.keys(group.members).forEach(function(member){
    log(group.members[member].nick,group.members[member].hashname);
  });
}
cmds.g = function(arg){
  var group = groups.get(arg.shift());
  Object.keys(group.members).forEach(function(member){
    group.members[member].send({js:{message:arg.join(" ")}});
  });
}
cmds.join = function(arg)
{
  var group = groups.get(arg[0]);
  if(!arg[1]) return log("g["+group.id+"] created");
  var host = me.whois(arg[1]);
  if(!host) return log("invalid group hashname",arg[1]);
  log("g["+group.id+"] fetching members");
  host.start("members", {js:{group:group.id}}, function(err, arg, chan, cb)
  {
    if(err && err !== true) return log("group",group.id,"error fetching members",err);
    if(Array.isArray(arg.js.members)) arg.js.members.forEach(function(member){
      if(group.members[member]) return;
      if(member == me.hashname) return;
      var hn = me.whois(member);
      if(!hn) return log("g["+group.id+"] invalid member",member);
      hn.start("group", {js:{nick:id.nick, group:group.id}}, function(err, arg, chan, cb){
        if(err) return log("message handshake err",err);
        group.add(chan);
        groupInit(arg, chan);
        cb();
      });
    });
    cb();
  });
}
cmds.seek = function(arg)
{
  var hn = me.whois(arg[0]);
  if(!hn) return log("invalid hashname",arg[0]);
  me.seek(hn, function(err){
    if(err) return log("seek failed",hn.hashname,err);
    log("seek",hn.hashname,JSON.stringify(hn.vias));
  });
}
cmds.ping = function(arg)
{
  var hn = me.whois(arg[0]);
  if(!hn) return log("invalid hashname",arg[0]);
  hn.seek(me.hashname,function(err){
    if(err) return log("ping failed",hn.hashname,err);
    log("ping",hn.address);
  });
}
