/* eslint-disable react/jsx-no-undef */
/* eslint-disable no-undef */
/* eslint-disable react/react-in-jsx-scope */


/* eslint-disable react/jsx-filename-extension */
const SliderWidget = ({
    widget,
    setWidgetValue,
    sendValue,
    isRequesting,
}) => {
    React.useEffect(() => {
        if (widget.value !== widget.tmpValue) {
            setWidgetValue(undefined, widget, 'tmpValue');
        }
    }, [widget.value]);

    return (
        <div
            style={{
                height: 'inherit',
                padding: '0 24px',
                display: 'flex',
                justifyContent: 'space-around',
                flexDirection: 'column',
            }}
        >
            <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
            <div style={{
                display: 'flex',
                alignContent: 'center',
                justifyContent: 'center',
                alignItems: 'center',
                flexGrow: '1',
            }}
            >
                <Stack
                    spacing={1}
                    direction={widget.settings.isHorizontal ? 'row' : 'column'}
                    justifyContent="center"
                    alignItems="center"
                    style={{
                        width: '100%',
                        height: '100%',
                        paddingBottom: '1rem',
                    }}
                >
                    <Slider
                        sx={{
                            '& input[type="range"]': !widget.settings.isHorizontal && {
                                WebkitAppearance: 'slider-vertical',
                            },
                        }}
                        orientation={!widget.settings.isHorizontal ? 'vertical' : 'horizontal'}
                        aria-label="Small"
                        valueLabelDisplay="auto"
                        min={widget.settings.min}
                        max={widget.settings.max}
                        disabled={isRequesting}
                        value={widget.tmpValue ? widget.tmpValue : Number(widget.value)}
                        onChange={event => setWidgetValue(event.target.value, widget, 'tmpValue')}
                        onChangeCommitted={event => sendValue(event, widget)}
                    />
                </Stack>
            </div>
        </div>
    );
};

const BarWidget = ({ widget }) => {
    let barRatio = (widget.value - widget.settings.min) / widget.settings.max;
    if (barRatio > 1) barRatio = 1;
    const displayRatio = widget.settings.isHorizontal ? barRatio : 1 - barRatio;
    const handleHeight = widget.settings.isHorizontal ? '3rem' : `${displayRatio * 100}%`;
    const handleWidth = widget.settings.isHorizontal ? `${displayRatio * 100}%` : '100%';
    const value = parseFloat(widget.value);

    return (
        <div
            style={{
                height: 'inherit',
                padding: '0 24px',
                display: 'flex',
                justifyContent: 'space-around',
                flexDirection: 'column',
            }}
        >
            <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
            <div style={{
                display: 'flex',
                alignContent: 'center',
                justifyContent: 'center',
                flexGrow: '1',
            }}
            >
                <Stack
                    spacing={0.5}
                    direction={widget.settings.isHorizontal ? 'row-reverse' : 'column-reverse'}
                    justifyContent="center"
                    alignItems="stretch"
                    style={{
                        width: '100%',
                        height: '100%',
                    }}
                >
                    <Stack
                        direction={widget.settings.isHorizontal ? 'column' : 'row'}
                        alignItems="stretch"
                        justifyContent="center"
                        style={{
                            width: 'inherit',
                            position: 'relative',
                            height: widget.settings.isHorizontal ? '3rem' : '90%',
                            backgroundColor: widget.settings.isHorizontal ? '#e9ecef' : '#1976d2',
                            top: widget.settings.isHorizontal && '50%',
                            transform: widget.settings.isHorizontal && 'translate(0, -50%)',
                        }}
                    >
                        <div style={{
                            backgroundColor: widget.settings.isHorizontal ? '#1976d2' : '#e9ecef',
                            height: handleHeight,
                            width: handleWidth,
                            transition: 'height 0.1s ease-out, width 0.1s ease-out',
                        }}
                        />
                        <h6 style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            transform: 'translate(-50%, -50%)',
                            color: `${barRatio > 0.50 ? 'white' : 'black'}`,
                        }}
                        >
                            {value.toFixed(widget.settings.decimalPlaces)}
                        </h6>
                    </Stack>
                </Stack>
            </div>
        </div>
    );
};

const CmdButtonWidget = ({
    widget,
    setWidgetValue,
    sendValue,
    isRequesting,
}) => {
    return (
        <MuiContainer
            spacing={0}
            style={{
                display: 'flex',
                height: '100%',
                flexDirection: 'column',
            }}
        >
            <Stack direction="column" spacing={0} justifyContent="center" alignItems="stretch">
                <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
            </Stack>
            <Stack
                direction="column"
                spacing={1}
                justifyContent="center"
                alignItems="center"
                size="small"
                style={{
                    flexGrow: '1',
                }}
            >
                {
                    widget.settings.hasInput
                    && (
                        <TextField
                            hiddenLabel
                            id="standard-basic"
                            variant="standard"
                            size="small"
                            value={widget.tmpValue}
                            onChange={event => setWidgetValue(event.target.value, widget, 'tmpValue')}
                        />
                    )

                }
                <MuiButton
                    disabled={isRequesting || (widget.settings.hasInput && !widget.tmpValue)}
                    variant="contained"
                    onClick={event => sendValue(event, widget)}
                >
                    <span className="material-symbols-outlined">play_arrow</span>
                </MuiButton>
            </Stack>
        </MuiContainer>
    );
};

const getAngle = (value, imin, imax, omin, omax) => (
    (value - imin) / (imax - imin) * (omax - omin) + omin
);


const RadialGauge = ({
    min,
    max,
    value,
}) => {
    return (
        <div
            className="gauge"
        >
            <div className="gauge__body">
                <div
                    className="gauge__fill"
                    style={{
                        '--angle': `${getAngle(value, min, max, 0, 180)}deg`,
                    }}
                />
                <div
                    className="gauge__cover"
                />
            </div>
        </div>

    );
};

const GaugeWidget = ({ widget }) => {
    const value = parseFloat(widget.value);
    return (
        <MuiContainer
            spacing={0}
            style={{
                display: 'flex',
                height: '100%',
                flexDirection: 'column',
            }}
        >
            <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
            <Stack
                direction="column"
                alignItems="center"
                justifyContent="center"
                style={{
                    flexGrow: '1',
                }}
            >
                <RadialGauge
                    min={widget.settings.min}
                    max={widget.settings.max}
                    value={widget.value}
                />
                <h6 style={{
                    transform: 'translate(0, -100%)',
                }}
                >
                    {value.toFixed(widget.settings.decimalPlaces)}
                </h6>
            </Stack>
        </MuiContainer>
    );
};

const CardWidget = ({ widget }) => {
    const value = parseFloat(widget.value);
    return (
        <MuiContainer
            spacing={0}
        >
            <Stack direction="column" spacing={0} justifyContent="center" alignItems="stretch">
                <Stack direction="row" alignItems="flex-start"><h4>{widget.settings.label}</h4></Stack>
                <Stack direction="row" justifyContent="flex-end">
                    <h2>{value.toFixed(widget.settings.decimalPlaces)}</h2>
                </Stack>
            </Stack>
        </MuiContainer>
    );
};

const SwitchWidget = ({
    widget,
    isRequesting,
    setWidgetValue,
    setSettingValue,
    sendValue,
}) => {
    const handleToggleSwitch = (value, widget) => {
        if (value === true) {
            setWidgetValue(widget.settings.max, widget, 'tmpValue');
        } else {
            setWidgetValue(widget.settings.min, widget, 'tmpValue');
        }
        sendValue(false, widget);
        setSettingValue(value, widget, 'isOn');
    };


    return (
        <MuiContainer
            spacing={0}
        >
            <Stack direction="column" spacing={0} justifyContent="center" alignItems="stretch">
                <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
                <Stack direction="row" justifyContent="space-between">
                    {
                        widget.settings.isOn
                            ? (
                                <>
                                    <p>
                                        {widget.settings.offLabel !== ''
                                            ? widget.settings.offLabel
                                            : widget.settings.min}
                                    </p>
                                    <h2>
                                        {widget.settings.onLabel !== ''
                                            ? widget.settings.onLabel
                                            : widget.settings.max}
                                    </h2>
                                </>
                            )
                            : (
                                <>
                                    <h2>
                                        {widget.settings.offLabel !== ''
                                            ? widget.settings.offLabel
                                            : widget.settings.min}
                                    </h2>
                                    <p>
                                        {widget.settings.onLabel !== ''
                                            ? widget.settings.onLabel
                                            : widget.settings.max}
                                    </p>
                                </>
                            )
                    }
                </Stack>
            </Stack>
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" size="small">
                <Switch
                    checked={widget.settings.isOn}
                    onChange={event => handleToggleSwitch(event.target.checked, widget)}
                    disabled={isRequesting}
                />
            </Stack>
        </MuiContainer>
    );
};

const TextInputWidget = ({
    widget,
    isRequesting,
    sendValue,
    setWidgetValue,
}) => {
    return (
        <MuiContainer
            direction="column"
            spacing={0}
        >
            <Stack direction="column" spacing={0} justifyContent="center" alignItems="stretch">
                <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
                <Stack direction="row" justifyContent="flex-end">
                    <h2>{widget.value ? widget.value : 555}</h2>
                </Stack>
            </Stack>
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" size="small">
                <TextField value={widget.tmpValue} onChange={event => setWidgetValue(event.target.value, widget, 'tmpValue')} hiddenLabel id="standard-basic" variant="standard" size="small" />
                <MuiButton variant="contained" onClick={event => sendValue(event, widget)} disabled={isRequesting}><span className="material-symbols-outlined">done</span></MuiButton>
            </Stack>
        </MuiContainer>
    );
};

const LineWidget = ({
    widget,
}) => {
    const dataset = widget.data;
    while (dataset.length < 50) {
        dataset.push({
            name: 'c',
            value: NaN,
        });
    }
    const data = {
        labels: dataset.slice(-50).map(el => el.name),
        datasets: [
            {
                label: widget.variable,
                data: dataset.slice(-50).map(el => Number(el.value)),
                fill: true,
                borderColor: 'rgb(25, 118, 210)',
                backgroundColor: (context) => {
                    const ctx = context.chart.ctx;
                    const gradient = ctx.createLinearGradient(0, 0, 0, 500);
                    gradient.addColorStop(0, 'rgba(25,118,210,1)');
                    gradient.addColorStop(1, 'rgba(25,118,210,0)');
                    return gradient;
                },
                tension: 0.1,
                radius: 0,
                pointBorderColor: 'rgba(25, 118, 210, 0)',
            },
        ],
    };

    const options = {
        responsive: true,
        plugins: {
            legend: {
                display: false,
            },
            title: {
                display: false,
            },
        },
        animation: {
            duration: 0,
        },
        scales: {
            xAxis: {
                display: false,
            },
            yAxis: {
                suggestedMin: widget.settings.min,
                suggestedMax: widget.settings.max,
                position: 'right',
                ticks: {
                    maxTicksLimit: 10,
                },
            },
        },
        maintainAspectRatio: false,
    };

    return (
        <MuiContainer
            direction="column"
            spacing={0}
            style={{
                height: 'inherit',
                width: 'inherit',
            }}
        >
            <Stack direction="row" alignItems="flex-start"><h6>{widget.settings.label}</h6></Stack>
            <div style={{ position: 'relative', height: '90%' }}>
                <Line
                    data={data}
                    options={options}
                    redraw
                    updateMode="normal"
                />
            </div>
        </MuiContainer>
    );
};


export {
    TextInputWidget,
    SliderWidget,
    BarWidget,
    CmdButtonWidget,
    GaugeWidget,
    CardWidget,
    SwitchWidget,
    LineWidget,
};
