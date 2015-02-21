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
  mesh.chat = function(args, cbReady)
  {
    if(typeof args == 'function' && !cbReady)
    {
      cbReady = args;
      args = {};
    }
    // accept uri arg
    if(typeof args == 'string')
    {
      var leader = mesh.link(args);
      if(!leader || !leader.args.token) return cbReady('bad uri: '+args);
      args = {leader:leader,id:leader.args.token};
    }
    if(typeof args != 'object') return cbReady('bad args');

    // generate or load basics for the unique chat id
    var chat = {};
    chat.secret = args.secret || crypto.randomBytes(8);
    chat.depth = args.depth || 1000;
    chat.seq = args.seq || chat.depth;
    chat.id = args.id || stamp();
    self.chats[chat.id] = chat;

    chat.leader = args.leader || mesh;
    chat.messages = {}; // index of all cached chat messages "id":{...}
    chat.log = []; // ordered combined history ["id","id"]
    chat.roster = {}; // joins by hashname
    chat.last = {}; // lasts by hashname
    chat.joined = false;
    chat.inbox = new streamlib.Readable({objectMode:true});
    chat.inbox._read = function(){}; // all evented
    chat.outbox = new streamlib.Writable({objectMode:true});
    chat.connecting = {}; // incoming opens
    
    // in scope only
    var connected = {}; // by hashname, channels

    // load more history on demand, tries to get 'back' number from every participant
    chat.history = function(back, cbDone){
      
    };

    // serve the thtp requests for this chat
    chat.base = '/chat/'+chat.id+'/';
    mesh.match(chat.base,function(req,res){
      var parts = req.url.split('/');
      if(parts[3] == 'roster') return res.end(JSON.stringify(chat.roster));
      if(parts[3] == 'id' && chat.messages[parts[4]]) return res.end(chat.messages[parts[4]]);
      mesh.log.debug('unknown request',parts);
      res.writeHead(404).end();
    });

    function fail(err, cbErr)
    {
      if(!err) return; // only catch errors
      chat.err = err;
      // TODO error inbox/outbox
      if(cbErr) cbErr(err);
    }

    // internal message id generator
    function stamp()
    {
      if(!chat.seq) return fail('chat history overflow, please restart');
      var id = lib.sip.hash(mesh.hashname, chat.secret);
      for(var i = 0; i < chat.seq; i++) id = lib.sip.hash(id.key,id);
      chat.seq--;
      return lib.base32.encode(id);
    }

    chat.join = function(join, cbDone)
    {
      if(!cbDone) cbDone = function(err){ if(err) mesh.log.debug(err); };
      if(chat.joined) return cbDone('already joined');
      if(!join) return cbDone('requires join message');
      if(typeof join == 'string') join = {json:{text:join}}; // convenient
      if(!join.json) join = {json:join}; // friendly to make a packet
      chat.joined = join;
      join.json.type = 'join';
      join.json.id = (chat.leader == mesh) ? chat.id : stamp();
      chat.roster[mesh.hashname] = join.json.id;
      chat.send(join);
      
      // tries to sync first if we're not the leader
      chat.sync(cbDone);
    }
    
    // internal to cache and event a message
    chat.receive = function(link, msg)
    {
      msg.from = link.hashname;

      // put in our caches/log
      if(msg.json.type == 'chat' || msg.json.type == 'join')
      {
        chat.messages[msg.json.id] = msg;
        chat.last[msg.from] = msg.json.id; // our last id
      // TODO put ordered in chat.log
        chat.log.unshift(msg);
      }
      mesh.log.debug('receiving message',msg.from,msg.json);
      chat.inbox.push(msg);
    }

    // ensures it's in our cache or fetches if not
    chat.cache = function(link, id, cbDone)
    {
      if(chat.messages[id]) return cbDone(undefined, chat.messages[id]);
      link.request(chat.base+'id/'+id, function(err, res){
        if(err) return cbDone(err);
        if(res.statusCode != 200) return cbDone(res.statusCode);
        var parts = [];
        res.on('data',function(data){ parts.push(data);}).on('end',function(){
          var msg = lib.lob.decode(Buffer.concat(parts));
          if(!msg) return cbDone('parse error');
          if(msg.json.id != id) return cbDone('id mismatch');
          chat.receive(link, msg);
          cbDone(undefined, msg);
        });
      });
      
    }

    chat.sync = function(cbDone)
    {
      // leader is always in sync
      if(chat.leader == mesh) return cbDone(undefined, chat);

      // non-leaders always fetch updated roster to sync
      var parts = [];
      chat.leader.request(chat.base+'roster', function(err, res){
        if(err) return cbDone(err);
        res.on('data',function(data){ parts.push(data);}).on('end',function(){
          var body = Buffer.concat(parts);
          try{
            chat.roster = JSON.parse(body.toString());
          }catch(E){
            return fail(E.toString(), cbDone);
          }
          
          // create a queue of required message ids to sync
          var queue = [chat.id];
          Object.keys(chat.roster).forEach(function(hn){
            if(hn == mesh.hashname) return; // skip self
            chat.add(hn); // check/try connection
            if(chat.roster[hn] != '*') queue.push(chat.roster[hn]); // sync any joins
          });
        
          // sync the message queue before being done
          function iter()
          {
            if(!queue.length) return cbDone(undefined, chat);
            chat.cache(chat.leader, queue.shift(), iter);
          }
          iter();
        });
      });
    }

    // this channel is ready
    chat.connected = function(link, channel, cbDone)
    {
      mesh.log.debug('chat connected',link.hashname);
      // TODO disconnect old channels
      var stream = connected[link.hashname] = mesh.streamize(channel, 'lob');
      stream.on('data', function(msg){
        // TODO validate id!
        if(!msg.json.id) return mesh.log.debug('bad message',msg.json);
        chat.receive(link, msg);
      });
      // TODO end/cleanup

      // ensures messages are sync'd
      chat.cache(link, chat.last[link.hashname], function(){
        chat.cache(link, chat.roster[link.hashname], cbDone);
      });
      
    }

    chat.add = function(hashname, cbDone){
      function done(err, join)
      {
        if(err) mesh.log.debug(err);
        if(cbDone) cbDone(err, join);
        cbDone = false;
      };
      if(typeof hashname == 'object') hashname = hashname.hashname; // allow passing a link obj
      if(!lib.hashname.isHashname(hashname)) return done('invalid hashname'); // sanity check
      if(!chat.roster[hashname] && chat.leader != mesh) return done('not the leader'); // only leaders can add new
      if(!chat.roster[hashname]) chat.roster[hashname] = '*'; // allow in master roster
      if(!chat.joined) return done('not joined'); // must be joined
      mesh.link(hashname, function(err, link){
        if(err || !link.up) return done('offline'); // must be online
      
        // minimum chat packet
        var json = {join:chat.joined.json.id, last:chat.last[mesh.hashname]};

        // check if there's a waiting open to respond to
        if(chat.connecting[hashname])
        {
          mesh.log.debug('responding to cached open',chat.connecting[hashname]);
          var packet = chat.connecting[hashname];
          delete chat.connecting[hashname];
          chat.last[hashname] = packet.json.last;
          var channel = link.x.channel(packet);
          channel.receive(packet); // for reliability
          channel.send({json:json});
          chat.connected(link, channel, done);
          return;
        }
      
        if(connected[hashname]) return done(undefined, chat.roster[hashname]); // already online
      
        // start a new outgoing chat channel
        json.type = 'chat';
        json.seq = 1; // always reliable
        json.chat = chat.id;
        var channel = link.x.channel({json:json});
        
        // process first response before making connected
        channel.receiving = function(err, packet, cbMore) {
          if(err) return done(err);
          if(!packet.json.join || !packet.json.last) return done('bad chat response');
          if(chat.roster[hashname] == '*') chat.roster[hashname] = packet.json.join;
          if(chat.roster[hashname] != packet.json.join) return done('bad chat join');
          chat.last[hashname] = packet.json.last;
          chat.connected(link, channel, done);
          cbMore();
        };

        mesh.log.debug('sending chat',json);
        channel.send({json:json});
      });

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
      chat.receive(mesh, msg);

      // deliver to anyone connected
      Object.keys(connected).forEach(function(to){
        mesh.log.debug('sending to',to,msg.json.id);
        connected[to].write(msg);
        // TODO, set up auto-delivery ack events
      });
    }
    
    // read messages from stream too
    chat.outbox._write = function(data, enc, cbDone){
      chat.send(data);
      cbDone();
    };
  
    chat.sync(cbReady);
    return chat;
  }


  self.open.chat = function(args, open, cbOpen){
    var link = this;

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    // process invites
    var chat = self.chats[open.json.chat];
    if(!chat)
    {
      if(open.json.chat != open.json.join) return cbOpen('unknown chat');
      if(!cbInvite) return cbOpen('cannot accept invites');
      // create to load roster then call invited
      mesh.log.debug('CHAT INVITE',open.json);
      mesh.chat({leader:link,id:open.json.chat},function(err, chat){
        if(err) return cbOpen(err);
        chat.connecting[link.hashname] = open;
        cbInvite(chat);
        cbOpen();
      });
      return;
    }

    mesh.log.debug('CHAT REQUEST',open.json,chat);

    if(open.json.chat != chat.id) return mesh.log.warn('bad chat id',open.json);
    if(!open.json.join || !open.json.last) return mesh.log.warn('bad chat open',open.json);
    if(chat.roster[link.hashname] == '*') chat.roster[link.hashname] = open.json.join;
    if(chat.roster[link.hashname] != open.json.join) return mesh.log.warn('bad chat join',open.json);

    // let chat.add respond
    chat.connecting[link.hashname] = open;
    chat.add(link.hashname, function(err){
      cbOpen(err);
    });

  }

  cbMesh(undefined, self);

}