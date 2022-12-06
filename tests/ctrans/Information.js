/* eslint-disable react/jsx-no-undef */
/* eslint-disable no-undef */
/* eslint-disable import/prefer-default-export */
/* eslint-disable react/react-in-jsx-scope */
/* eslint-disable react/jsx-filename-extension */

const FirmwareVersion = ({ value, key }) => {
    return (
        <InformationElement label="Firmware Version" key={key}>
            <SpanSelectAll value={value} />
        </InformationElement>
    );
};
const Ip = ({ value, key }) => {
    return (
        <InformationElement label="IP Address" key={key}>
            <SpanSelectAll value={value} />
        </InformationElement>
    );
};
const Mac = ({ value, key }) => {
    const hexMac = value.split('.').map(number => Number(number).toString(16)).join(':');
    return (
        <InformationElement label="MAC Address" key={key}>
            <div>
                <SpanSelectAll value={value} />
                (
                <SpanSelectAll value={hexMac} />
                )
            </div>
        </InformationElement>
    );
};
const Uptime = ({ value, key }) => {
    return (
        <InformationElement label="Uptime" key={key}>
            <span>{value.toISOString().substr(11, 8)}</span>
        </InformationElement>
    );
};
const WifiOn = ({ value, key }) => {
    return (
        <InformationElement label="Wifi Status" key={key}>
            <span>{value === 1 ? 'On' : 'Off'}</span>
        </InformationElement>
    );
};

const InformationElement = ({
    label,
    key,
    children,
    action,
}) => {
    const labelStyle = {
        fontWeight: 'bold',
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
        }}
        >
            <div
                key={key}
                style={{
                    width: 'clamp(25%,40%,100%)',
                    padding: '0.5rem 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <span style={labelStyle}>{label}</span>
                {children}
            </div>
            &nbsp;
            {action || <div />}
        </div>
    );
};

const SpanSelectAll = ({ value }) => {
    return (
        <span style={{
            userSelect: 'all',
        }}
        >
            {value}
        </span>
    );
};

const options = [
    {
        name: 'UTC-12:00',
        value: '0',
        minutesOffset: -60 * 12,
    },
    {
        name: 'UTC-11:00',
        value: '1',
        minutesOffset: -60 * 11,
    },
    {
        name: 'UTC-10:00',
        value: '2',
        minutesOffset: -60 * 10,
    },
    {
        name: 'UTC-09:00',
        value: '3',
        minutesOffset: -60 * 9,
    },
    {
        name: 'UTC-08:00',
        value: '4',
        minutesOffset: -60 * 8,
    },
    {
        name: 'UTC-07:00',
        value: '5',
        minutesOffset: -60 * 7,
    },
    {
        name: 'UTC-06:00',
        value: '6',
        minutesOffset: -60 * 6,
    },
    {
        name: 'UTC-05:00',
        value: '7',
        minutesOffset: -60 * 5,
    },
    {
        name: 'UTC-04:00',
        value: '9',
        minutesOffset: -60 * 4,
    },
    {
        name: 'UTC-03:00',
        value: '11',
        minutesOffset: -60 * 3,
    },
    {
        name: 'UTC-02:00',
        value: '12',
        minutesOffset: -60 * 2,
    },
    {
        name: 'UTC-01:00',
        value: '13',
        minutesOffset: -60 * 1,
    },
    {
        name: 'UTC',
        value: '14',
        minutesOffset: 60 * 0,
    },
    {
        name: 'UTC+01:00',
        value: '15',
        minutesOffset: 60 * 1,
    },
    {
        name: 'UTC+02:00',
        value: '16',
        minutesOffset: 60 * 2,
    },
    {
        name: 'UTC+03:00',
        value: '17',
        minutesOffset: 60 * 3,
    },
    {
        name: 'UTC+04:00',
        value: '19',
        minutesOffset: 60 * 4,
    },
    {
        name: 'UTC+05:00',
        value: '21',
        minutesOffset: 60 * 5,
    },
    {
        name: 'UTC+06:00',
        value: '24',
        minutesOffset: 60 * 6,
    },
    {
        name: 'UTC+07:00',
        value: '26',
        minutesOffset: 60 * 7,
    },
    {
        name: 'UTC+08:00',
        value: '27',
        minutesOffset: 60 * 8,
    },
    {
        name: 'UTC+09:00',
        value: '28',
        minutesOffset: 60 * 9,
    },
    {
        name: 'UTC+10:00',
        value: '30',
        minutesOffset: 60 * 10,
    },
    {
        name: 'UTC+11:00',
        value: '31',
        minutesOffset: 60 * 11,
    },
    {
        name: 'UTC+12:00',
        value: '32',
        minutesOffset: 60 * 12,
    },
    {
        name: 'UTC+13:00',
        value: '33',
        minutesOffset: 60 * 13,
    },
];

const Timestamp = ({
    value, key, selected, setSnackbarOn, update,
}) => {
    const [isEditing, setIsEditing] = React.useState(false);
    const [newDate, setNewDate] = React.useState(value);

    function padTo2Digits(num) {
        return num.toString().padStart(2, '0');
    }
    function formatDate(date) {
        const dateTime = new Date((date) * 1000);
        const year = padTo2Digits(dateTime.getFullYear());
        const month = padTo2Digits(dateTime.getMonth() + 1);
        const day = padTo2Digits(dateTime.getDate());
        const hours = padTo2Digits(dateTime.getHours());
        const minutes = padTo2Digits(dateTime.getMinutes());
        const seconds = padTo2Digits(dateTime.getSeconds());
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }

    const handleChange = (e) => {
        const value = Date.parse(e.target.value);
        setNewDate(value / 1000);
    };
    const updateTime = () => {
        const minutesOffset = options
            .find(option => option.value === selected).minutesOffset * 60;
        const timestamp = newDate + minutesOffset;
        fetch(`${API_URL_BASE}/api.html?e=i&action=edit_t&t=${timestamp}`).then(res => res.text())
            .then(
                (result) => {
                    setSnackbarOn(true);
                    update();
                    setIsEditing(false);
                },
                (error) => {
                    alert('error sending', error);
                    console.error(error);
                },
            );
    };

    const getLocalTime = () => {
        const value = (Date.parse(new Date()));
        setNewDate(value / 1000);
    };

    const action = isEditing
        ? (
            <>
                <Button onClick={updateTime}>Update</Button>
                &nbsp;
                <Button onClick={getLocalTime} variant="info">Local</Button>
                &nbsp;
                <Button onClick={() => setIsEditing(false)} variant="secondary">Cancel</Button>
            </>
        )
        : (
            <Button onClick={() => setIsEditing(true)}>Set</Button>
        );


    return (
        <InformationElement label="Device time" key={key} action={action}>
            {
                isEditing
                    ? (
                        <div className="col-sm-5">
                            <input className="form-control" type="datetime-local" value={formatDate(newDate)} onChange={handleChange} />
                        </div>
                    )
                    : (
                        <span>
                            {formatDate(value).replace('T', ' ')}
                        </span>
                    )
            }
        </InformationElement>
    );
};

const UTC = ({
    value, key, setSnackbarOn, selected, setSelected, update,
}) => {
    const updateTz = () => {
        fetch(`${API_URL_BASE}/api.html?e=i&action=edit_tz&tz=${selected}`).then(res => res.text())
            .then(
                (result) => {
                    // alert(result);
                    setSnackbarOn(true);
                    update();
                },
                (error) => {
                    alert('error sending', error);
                    console.error(error);
                },
            );
    };

    const action = (
        <Button
            onClick={updateTz}
            disabled={value === selected}
        >
                Update
        </Button>
    );

    return (
        <InformationElement label="Timezone" key={key} action={action}>
            <div className="col-sm-4">
                <select className="form-select" value={selected} onChange={e => setSelected(e.target.value)}>
                    {
                        options.map((option, i) => {
                            return (
                                <option value={option.value} key={i}>{option.name}</option>
                            );
                        })
                    }
                </select>
            </div>
        </InformationElement>
    );
};

const infoElements = [
    'firmwareVersion',
    'ip',
    'mac',
    'uptime',
    'wifiOn',
    'timezone',
    'time',
];

const Information = ({ infoValues, update }) => {
    const [snackbarOn, setSnackbarOn] = React.useState(false);
    const [selectedTZOffset, setSelectedTZOffset] = React.useState(infoValues.timezone);

    const [uptime, setUptime] = React.useState(new Date(infoValues.uptime / 2 * 1000));
    const [time, setTime] = React.useState(Number(infoValues.time));
    React.useEffect(() => {
        const interval = setInterval(
            () => {
                setUptime((uptime) => {
                    uptime.setSeconds(uptime.getSeconds() + 1);
                    const clonedDate = new Date(uptime.getTime());
                    return clonedDate;
                });
                setTime(time => time + 1);
            },
            1000,
        );
        return () => {
            clearInterval(interval);
        };
    }, []);

    React.useEffect(() => {
        setTime(Number(infoValues.time));
    }, [infoValues.time]);


    return (
        <>
            {
                infoElements.map((name) => {
                    if (!infoValues[name]) {
                        return <></>;
                    }
                    if (name === 'firmwareVersion') {
                        return <FirmwareVersion value={infoValues[name]} key={name} />;
                    }
                    if (name === 'ip') {
                        return <Ip value={infoValues[name]} key={name} />;
                    }
                    if (name === 'mac') {
                        return <Mac value={infoValues[name]} key={name} />;
                    }
                    if (name === 'uptime') {
                        return <Uptime value={uptime} key={name} />;
                    }
                    if (name === 'wifiOn') {
                        return <WifiOn value={infoValues[name]} key={name} />;
                    }
                    if (name === 'time') {
                        return (
                            <Timestamp
                                value={time}
                                key={name}
                                selected={selectedTZOffset}
                                setSnackbarOn={setSnackbarOn}
                                update={update}
                            />
                        );
                    }
                    if (name === 'timezone') {
                        return (
                            <UTC
                                value={infoValues[name]}
                                key={name}
                                setSnackbarOn={setSnackbarOn}
                                selected={selectedTZOffset}
                                setSelected={setSelectedTZOffset}
                                update={update}
                            />
                        );
                    }
                    return <div key={name}>todo</div>;
                })
            }
            <Snackbar
                open={snackbarOn}
                autoHideDuration={3000}
                onClose={() => setSnackbarOn(false)}
                message="Updated"
            />
        </>
    );
};

export { Information };
