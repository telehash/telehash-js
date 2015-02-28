var crypto = require('crypto');
var streamlib = require('stream');

// implements https://github.com/telehash/telehash.org/blob/master/v3/channels/chat.md
exports.name = 'chat';

exports.mesh = function(mesh, cbMesh)
{
  var lib = mesh.lib;
  var self = {open:{}, chats:{}};

  // overwrite-able callback for invites
  var cbInvite = false;
  mesh.invited = function(handler){ cbInvite = handler; };
  
  // create/join a new chat
  mesh.chat = function(args, profile, cbReady)
  {
    // javascript is lame
    if(typeof profile == 'function')
    {
      cbReady = profile;
      profile = false;
    }
    if(!profile)
    {
      profile = args;
      args = {};
    }
    
    function readyUp(err)
    {
      if(err) mesh.log.debug('chat error', err);
      if(!cbReady) return;
      // I wish node unrolled itself
      var cb = cbReady;
      cbReady = false;
      cb(err, chat);
    }

    // accept uri arg
    if(typeof args == 'string')
    {
      var leader = mesh.link(args);
      if(!leader || !leader.args.query.id) return readyUp('bad uri: '+args);
      args = {leader:leader,id:leader.args.query.id};
    }
    if(typeof args != 'object') return readyUp('bad args');

    // generate or load basics for the unique chat id
    var chat = {};
    chat.secret = args.secret || crypto.randomBytes(8);
    chat.depth = args.depth || 1000;
    chat.seq = args.seq || chat.depth;
    chat.id = args.id || stamp();
    self.chats[chat.id] = chat;

    chat.leader = args.leader || mesh;
    chat.leading = (chat.leader == mesh) ? true : false;
    chat.messages = {}; // index of all cached chat messages "id":{...}
    chat.log = []; // ordered combined history ["id","id"]
    chat.profiles = {}; // profiles by hashname
    chat.last = {}; // last message id by hashname
    chat.invited = {}; // ACL
    chat.inbox = new streamlib.Readable({objectMode:true});
    chat.inbox._read = function(){}; // all evented
    chat.outbox = new streamlib.Writable({objectMode:true});
    chat.streams = {}; // by hashname
    
    // sanitize our profile
    if(typeof profile == 'string') profile = {json:{text:profile}}; // convenient
    if(!profile.json) profile = {json:profile};
    profile.json.type = 'profile';
    profile.json.id = (chat.leading) ? chat.id : stamp();
    chat.profile = lib.lob.packet(profile.json, profile.body);

    // internal fail handler
    function fail(err, cbErr)
    {
      if(!err) return; // only catch errors
      mesh.log.warn('chat fail',err);
      chat.err = err;
      // TODO error inbox/outbox
      if(typeof cbErr == 'function') cbErr(err);
      readyUp(err);
    }

    // internal message id generator
    function stamp()
    {
      if(!chat.seq) return fail('chat history overflow, please restart');
      var id = lib.hashname.siphash(mesh.hashname, chat.secret);
      for(var i = 0; i < chat.seq; i++) id = lib.hashname.siphash(id.key,id);
      chat.seq--;
      return lib.base32.encode(id);
    }

    // internal to cache and event a message
    chat.receive = function(from, msg)
    {
      msg.from = from;

      // massage join's attached profile
      if(msg.json.type == 'join')
      {
        msg.join = lib.lob.decode(msg.body);
        msg.json.join = msg.join.json; // convenience
      }

      // put in our caches/log
      if(msg.json.type == 'chat' || msg.json.type == 'join')
      {
        if(chat.messages[msg.json.id] && chat.messages[msg.json.id].json.text == msg.json.text) return mesh.log.debug('ignoring duplicate message');
        chat.messages[msg.json.id] = msg;
        chat.last[from] = msg.json.id;
      // TODO put ordered in chat.log
        chat.log.unshift(msg);
      }

      mesh.log.debug('receiving message',msg.from,msg.json);
      chat.inbox.push(msg);
    }

    // internal to add a profile
    chat.add = function(from, profile)
    {
      profile.from = from;
      chat.profiles[from] = profile;
      if(!chat.last[from]) chat.last[from] = profile.json.id;
      chat.messages[profile.json.id] = profile;
      mesh.log.debug('added profile',profile.json.id,from);
    }
    
    // this channel is ready
    chat.connect = function(link, channel, last)
    {
      mesh.log.debug('chat connected',link.hashname);

      // see if replacing existing stream
      if(chat.streams[link.hashname])
      {
        // TODO BUGGY
//        chat.streams[link.hashname].end();
      }else{
        chat.receive(link.hashname, lib.lob.packet({type:'connect'}));
      }

      var stream = chat.streams[link.hashname] = mesh.streamize(channel, 'lob');

      stream.on('data', function(msg){
        // make sure is sequential/valid id
        if(!msg.json.id) return mesh.log.debug('bad message',msg.json);
        var next = lib.base32.encode(lib.hashname.siphash(link.hashname, lib.base32.decode(msg.json.id)));
        if(msg.json.id != chat.last[link.hashname] && next != chat.last[link.hashname]) return mesh.log.warn('unsequenced message',msg.json,chat.last[link.hashname]);
        chat.receive(link.hashname, msg);
      });

      stream.on('end', function(){
        mesh.log.debug('chat stream ended',link.hashname);
        if(chat.streams[link.hashname] == stream)
        {
          chat.receive(link.hashname, lib.lob.packet({type:'disconnect'}));
          delete chat.streams[link.hashname];
        }
      });

      // send any messages since the last they saw
      function sync(id)
      {
        if(id == last.json.id) return;
        // bottoms up, send older first
        sync(lib.base32.encode(lib.hashname.siphash(mesh.hashname, lib.base32.decode(id))));
        stream.write(chat.messages[id]);
      }
      sync(chat.last[mesh.hashname]);

      // signal good startup
      readyUp();
      
      return stream;
    }

    chat.join = function(link, profile)
    {
      chat.invited[link.hashname] = true;

      // if we don't have their profile yet, send a join
      if(!chat.profiles[link.hashname])
      {
        var open = {json:{type:'profile',chat:chat.id,seq:1}};
        if(profile) open.json.profile = profile;
        var channel = link.x.channel(open);
        channel.send(open);
        var stream = mesh.streamize(channel,'lob');
        stream.write(chat.profile);
        stream.on('error', function(err){
          if(link == chat.leader) fail(err);
        });
        stream.on('finish',function(){
          if(chat.profiles[link.hashname]) chat.join(link);
        });
        stream.end();
        return;
      }
      
      // already connected
      if(chat.streams[link.hashname]) return;

      // let's get chatting
      var open = {json:{type:'chat',chat:chat.id,seq:1}};
      open.json.last = chat.last[link.hashname];
      var chan = link.x.channel(open);
      chan.receiving = function(err, packet, cbMore) {
        if(packet)
        {
          var last = chat.messages[packet.json.last];
          if(!last || last.from != mesh.hashname) return cbMore('unknown last '+packet.json.last);
          chat.connect(link, chan, last);
          cbMore();
        }
      }
      chan.send(open);

    }

    // outgoing helper
    chat.send = function(msg)
    {
      if(typeof msg == 'string') msg = {json:{text:msg}}; // convenient
      if(!msg.json) msg = {json:msg}; // friendly to make a packet
      if(!msg.json.type) msg.json.type = 'chat';
      if(!msg.json.id) msg.json.id = stamp();
      if(!msg.json.at) msg.json.at = Math.floor(Date.now()/1000);
      if(!msg.json.after && chat.log[0]) msg.json.after = chat.log[0].json.id;
      msg = lib.lob.packet(msg.json,msg.body); // consistency

      // we receive it first
      chat.receive(mesh.hashname, msg);

      // deliver to anyone connected
      Object.keys(chat.streams).forEach(function(to){
        mesh.log.debug('sending to',to,msg.json.id);
        chat.streams[to].write(msg);
      });
    }
    
    // read messages from stream too
    chat.outbox._write = function(data, enc, cbDone){
      chat.send(data);
      cbDone();
    };

    // always add ourselves
    chat.add(mesh.hashname, chat.profile);
  
    // if not the leader, send our profile to them to start
    if(!chat.leading)
    {
      chat.join(chat.leader);
    }else{
      // leader auto-joins
      chat.send({json:{type:'join',from:mesh.hashname},body:lib.lob.encode(chat.profile)});
      readyUp();
    }

    return chat;
  }


  self.open.profile = function(args, open, cbOpen){
    var link = this;

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    // accept and stream until the profile
    var chan = link.x.channel(open);
    var stream = mesh.streamize(chan, 'lob');
    if(!stream) return cbOpen('invalid open');

    // wait for the profile message
    stream.on('data', function(profile){

      if(profile.json.type != 'profile' || !profile.json.id) return cbOpen('bad profile');

      mesh.log.debug('join request',open.json,profile.json);
      stream.end(); // send all done

      // process invites for unknown chats
      var chat = self.chats[open.json.chat];
      if(!chat)
      {
        if(open.json.chat != profile.json.id) return cbOpen('unknown chat');
        if(!cbInvite) return cbOpen('cannot accept invites');

        // send the invite request to the app
        cbInvite(link, profile);
        return;
      }
      
      // if they're the leader, accept their profile
      if(chat.leader == link)
      {
        // see if they need our profile yet
        if(!open.json.profile) chat.join(link, profile.json.id);

        // cache/track the profile
        chat.add(link.hashname, profile);

        // this will now connect
        if(open.json.profile) chat.join(link);

        return;
      }

      // not invited is request to join
      if(!chat.invited[link.hashname])
      {
        // event the profile for the app to decide on
        chat.receive(link.hashname, profile);
        return;
      }

      // see if they need our profile yet
      if(!open.json.profile) chat.join(link, profile.json.id);

      // add new profile, send a join message
      if(!chat.profiles[link.hashname])
      {
        chat.add(link.hashname, profile);
        var join = {json:{type:'join',from:link.hashname},body:lib.lob.encode(profile)};
        chat.send(join);
      }

      // if they have ours, this will get connected now
      if(open.json.profile) chat.join(link);

    });

    // process stream start
    chan.receive(open);

  }

  self.open.chat = function(args, open, cbOpen){
    var link = this;

    mesh.log.debug('chat request',open.json);

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    var chat = self.chats[open.json.chat];
    if(!chat) return cbOpen('unknown chat');
    if(!chat.profiles[link.hashname]) return cbOpen('no profile');
    var last = chat.messages[open.json.last];
    if(!last || last.from != mesh.hashname) return cbOpen('unknown last '+open.json.last);

    var chan = link.x.channel(open);
    chan.receive(open);
    // confirm
    chan.send({json:{last:chat.last[link.hashname]}});
    chat.connect(link, chan, last);
    
  }

  cbMesh(undefined, self);

}