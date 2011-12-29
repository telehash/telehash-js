// every seen IPP becomes a switch object that maintains itself
function Switch(ipp)
{
    this.ipp = ipp;
    this.active = false;
    // setup cleanup timer
    // use event emitter?
    return this;
}

exports.Switch = Switch;

// process incoming telex from this switch
Switch.prototype.incoming = function(telex)
{
    // TODO validate
    if(this.active) this.queue.push(telex);
}

Switch.prototype.
// handle own timer to send pings and clean up if dissappeared

// recursive find closer

function activate(s)
{
    s.active = true;
    s.queue = async.queue(s.process, 1);
    // adjust timers
}