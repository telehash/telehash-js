var crypto = require('crypto');
var stream = require('stream');

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
    chat.inbox = new stream.Readable();
    chat.outbox = new stream.Writable();
    
    // in scope only
    var connected = {}; // by hashname

    // load more history on demand, tries to get 'back' number from every participant
    chat.history = function(back, cbDone){
      
    };

    // serve the thtp requests for this chat
    chat.base = '/chat/'+chat.id+'/';
    mesh.match(chat.base,function(req,res){
      var parts = req.url.split('/');
      if(parts[3] == 'roster') return res.end(JSON.stringify(chat.roster));
      if(parts[3] == 'id' && chat.log[parts[4]]) return res.end(self.pencode(chat.log[parts[4]]));
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
      if(!join) return cbDone('requires join message');
      chat.seq = chat.depth;
      chat.joined = join;
      join.json.type = 'join';
      join.json.id = (chat.leader == mesh) ? chat.id : stamp();
      chat.roster[mesh.hashname] = chat.last[mesh.hashname] = join.json.id;
      join.json.at = Math.floor(Date.now()/1000);
      if(chat.log[0]) join.json.after = chat.log[0].id;
      
      // check chat.invited to respond
      if(chat.invited)
      {
        // temp hack! TODO
        var channel = chat.leader.x.channel(chat.invited);
        chat.invited = false;
        channel.send({json:{join:join.json.id,last:join.json.id}});
        var stream = connected[chat.leader.hashname] = mesh.streamize(channel, 'lob');
        // TODO refactor w/ copy code below
      }

      // tries to sync first if we're not the leader
      if(cbDone) chat.sync(cbDone);
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
            var roster = JSON.parse(body.toString());
          }catch(E){
            return fail(E.toString(), cbDone);
          }
          
          // create a queue of required message ids to sync
          var queue = [chat.id];
        
          // sync the roster, adding any new
          Object.keys(roster).forEach(function(hn){
            if(!chat.roster[hn]) chat.roster[hn] = roster[hn];
            chat.add(hn);
            // queue up known join ids to sync-fetch
            if(roster[hn] != '*') queue.push(roster[hn]);
          });
        
          // perform the queue before being done w/ the sync
          // TODO
          cbDone(undefined, chat);
        });
      });
    }

    chat.add = function(hashname, cbDone){
      if(!cbDone) cbDone = function(){};
      if(typeof hashname == 'object') hashname = hashname.hashname; // allow passing a link obj
      if(!lib.hashname.isHashname(hashname)) return cbDone('invalid hashname'); // sanity check
      if(!chat.roster[hashname] && chat.leader != mesh) return cbDone('not the leader'); // only leaders can add new
      if(!chat.roster[hashname]) chat.roster[hashname] = '*'; // allow in master roster
      if(!chat.joined) return cbDone('not joined'); // must be joined
      if(connected[hashname]) return cbDone(undefined, chat.roster[hashname]); // already online
      mesh.link(hashname, function(err, link){
        if(err || !link.up) return cbDone('offline'); // must be online
      
        // send a new chat invite channel
        var open = {type:'chat'};
        open.seq = 1; // always reliable
        open.join = open.chat = chat.id;
        open.last = chat.last[mesh.hashname];
        var channel = link.x.channel({json:open});
        
        // process first response before making connected
        channel.receiving = function(err, packet, cbMore) {
          if(err) return cbDone(err);
          if(!packet.json.join || !packet.json.last) return cbDone('bad chat response');
          if(chat.roster[hashname] == '*') chat.roster[hashname] = packet.json.join;
          if(chat.roster[hashname] != packet.json.join) return cbDone('bad chat join');
          chat.last[hashname] = packet.json.last;
          var stream = connected[hashname] = mesh.streamize(channel, 'lob');
          // TODO stream.pipe()
          // TODO get/cache join id
          cbMore();
          cbDone(undefined, packet.json.join);
        };

        mesh.log.debug('sending chat',open);
        channel.send({json:open});
      });

    }

    chat.send = function(msg)
    {
      if(!msg.json.type) msg.json.type = 'chat';
      if(!msg.json.id) msg.json.id = stamp();
      var packet = lib.lob.packet(msg.json,msg.body);

      if(msg.json.type == 'chat')
      {
        chat.log[msg.json.id] = packet;
        chat.last[mesh.hashname] = msg.json.id; // our last id
      }

      // deliver to anyone connected
      Object.keys(chat.connected).forEach(function(to){
        chat.connected[to].write(packet);
      });
    }
  
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
      mesh.chat({leader:link,id:open.json.chat},function(err, chat){
        if(err) return cbOpen(err);
        chat.invited = open;
        cbInvite(chat);
      });
      return;
    }

    log('CHAT REQUEST',open.json,chat);

    if(packet.json.chat != chat.id) return mesh.log.warn('bad chat id',packet);
    if(!packet.json.join || !packet.json.last) return mesh.log.warn('bad chat response',packet);
    if(chat.roster[hashname] == '*') chat.roster[hashname] = packet.json.join;
    if(chat.roster[hashname] != packet.json.join) return mesh.log.warn('bad chat join',packet);

    // is sender in the roster?
    // TODO respond, make channel, add connected

  }

  cbMesh(undefined, self);

}