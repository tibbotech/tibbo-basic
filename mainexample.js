
const { TiOS, sys, startSimulator } = require('./tios');
const app = new TiOS();
app.on_sys_timer = function () {
    sys.debugprint("asdf");
}

startSimulator(app);
