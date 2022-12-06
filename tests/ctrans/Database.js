/* eslint-disable jsx-a11y/label-has-for */
/* eslint-disable jsx-a11y/label-has-associated-control */
/* eslint-disable consistent-return */
/* eslint-disable react/jsx-no-undef */
/* eslint-disable react/jsx-filename-extension */
/* eslint-disable react/react-in-jsx-scope */
/* eslint-disable no-undef */
/* eslint-disable import/prefer-default-export */


const FilterType = {
    Contains: 'Contains',
    Equals: 'Equals',
    IsGreaterThan: 'Is greater than',
    IsLessThan: 'Is less than',
    IsEmpty: 'Is empty',
    IsNonEmpty: 'Is non-empty',
};

let filterDebounce;
const debounceTimeout = 1000;

const ImportProgress = ({ importRows }) => {
    let progress = 0;
    for (let i = 0; i < importRows.length; i++) {
        if (importRows[i].loaded) {
            progress++;
        }
    }
    const totalProgress = Math.round(progress / importRows.length * 100);
    return (
        <div>
            <ProgressBar variant="info" now={totalProgress} label={`${totalProgress}%`} />
        </div>
    );
};

const PaginationTable = ({ activeTable, changePage }) => {
    if (activeTable === undefined) {
        return;
    }
    const active = activeTable.page;
    const items = [];
    const remainder = activeTable.count % ROWS_PER_PAGE;
    const pages = (activeTable.count - remainder)
        / ROWS_PER_PAGE + (remainder > 0 ? 1 : 0);
    let minPage = active - 5;
    if (minPage < 0) {
        minPage = 0;
    }
    let maxPage = active + 5;
    if (maxPage >= pages - 1) {
        maxPage = pages - 1;
    }
    for (let number = minPage; number <= maxPage; number++) {
        items.push(
            <Pagination.Item key={number} active={number === (active)} activeLabel="" onClick={() => changePage(number)}>
                {number + 1}
            </Pagination.Item>,
        );
    }
    let max = activeTable.page * ROWS_PER_PAGE + ROWS_PER_PAGE;
    if (max > activeTable.count) {
        max = activeTable.count;
    }

    return (
        <div>
            <Pagination size="sm">
                <Pagination.First onClick={() => changePage(0)} />
                <Pagination.Prev onClick={() => changePage(active - 1)} />
                {items}
                <Pagination.Next onClick={() => changePage(active + 1)} />
                <Pagination.Last onClick={() => changePage(pages - 1)} />
            </Pagination>

            <span>
                {activeTable.page * ROWS_PER_PAGE + 1}
                &nbsp;-&nbsp;
                {max}
            </span>
            <span>
                &nbsp;of&nbsp;
                {activeTable.count}
            </span>

        </div>

    );
};

const TablesSidebar = ({ tables, activeTable, changeTable }) => {
    return tables.map((table, i) => {
        return (
            <ListGroup.Item as="li" active={activeTable.name === table.name} onClick={() => changeTable(table)} key={i}>
                {table.name}
            </ListGroup.Item>
        );
    });
};

const FieldInput = ({
    field, index, activeTable, editRow, fieldValueChanged,
}) => {
    const fieldType = activeTable.fields[index].fieldType;
    switch (fieldType) {
        case 'S':
            return (
                <Form.Control
                    type="text"
                    value={editRow[field.fieldName]}
                    onChange={e => fieldValueChanged(e, field.fieldName)}
                />
            );
        case 'E': {
            const d = new Date(Number(editRow[field.fieldName]) * 1000);
            return (
                <Form.Control
                    type="datetime-local"
                    value={(new Date(d.getTime()
                        - d.getTimezoneOffset()
                        * 60000).toISOString()).slice(0, -1)}
                    onChange={(e) => {
                        const dateTimeLocalValue = e.target.value;
                        const fakeUtcTime = new Date(`${dateTimeLocalValue}Z`);
                        const d = new Date(fakeUtcTime.getTime()
                            + fakeUtcTime.getTimezoneOffset() * 60000);
                        const newValue = Math.round(d.getTime() / 1000).toString();
                        fieldValueChanged({
                            target: {
                                value: newValue,
                            },
                        }, field.fieldName);
                    }}
                />
            );
        }
        case 'M': {
            const d = new Date(Number(editRow[field.fieldName]) * 1000);
            const value = editRow[field.fieldName];
            const remainder = Number(value) % 60;
            const hours = (Number(value) - remainder) / 60;
            const minutes = remainder;
            const timeValue = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            return (
                <Form.Control
                    type="time"
                    value={timeValue}
                    onChange={(e) => {
                        const value = e.target.value;
                        const parts = value.split(':');
                        const hours = parseInt(parts[0], 10);
                        const minutes = parseInt(parts[1], 10);
                        const newValue = (hours * 60 + minutes).toString();
                        fieldValueChanged({
                            target: {
                                value: newValue,
                            },
                        }, field.fieldName);
                    }}
                />
            );
        }
        default:

            return (
                <Form.Control
                    type="text"
                    value={editRow[field.fieldName]}
                    onChange={e => fieldValueChanged(e, field.fieldName)}
                />
            );
    }
};

const RenderedTable = ({
    activeTable,
    changeTable,
    showEdit,
    exportTable,
    setSort,
    getSortIcon,
    deleteRow,
    fileImport,
    importTable,
    selectedFields,
    toggleSelectedField,
    applyFilters,
    filters,
    addFilter,
    onChangeFilters,
    removeFilter,
    selectUnselectAll,
    clearFilters,
    allowEdit,
    clearTable,
}) => {
    const [toggleFilter, setToggleFilter] = React.useState(false);

    if (activeTable === undefined) {
        return;
    }
    return (
        <div>
            <Button onClick={() => changeTable(activeTable)}>
                Refresh
            </Button>
            &nbsp;
            <Button
                onClick={() => setToggleFilter(prev => !prev)}
                variant={
                    toggleFilter ? 'info' : 'primary'
                }
            >
                Filters
            </Button>
            &nbsp;
            {
                allowEdit
                && <Button onClick={() => showEdit(undefined)}>Add Entry</Button>
            }
            &nbsp;
            <Button onClick={() => exportTable(undefined)}>Export</Button>
            &nbsp;
            <Button onClick={() => clearTable()} variant="danger">Clear</Button>
            &nbsp;
            &nbsp;
            &nbsp;
            {
                allowEdit
                && (
                    <>
                        <input type="file" id="fileImport" ref={fileImport} />
                        <Button onClick={importTable}>Import</Button>
                    </>
                )
            }
            {
                toggleFilter
                    ? (
                        <div
                            className="border py-3 px-3 my-1"
                        >
                            <h5>Select fields</h5>
                            {
                                selectedFields.map((field, i) => {
                                    return (
                                        <div className="form-check form-check-inline" key={i}>
                                            <input
                                                className="form-check-input"
                                                type="checkbox"
                                                id={`inlineCheckbox${i}`}
                                                value={`option${i}`}
                                                checked={field.selected}
                                                onClick={() => toggleSelectedField(i)}
                                            />
                                            <label className="form-check-label" htmlFor={`inlineCheckbox${i}`}>{field.fieldName}</label>
                                        </div>
                                    );
                                })
                            }
                            <br />
                            <Button onClick={() => selectUnselectAll()} variant="secondary">Select all fields</Button>
                            <h5>Filters</h5>
                            {
                                filters.length > 0
                                && filters.map((filter, index) => {
                                    return (
                                        <div className="input-group mb-3" key={index}>
                                            <select className="form-select" value={filter.column} onChange={e => onChangeFilters(index, e, 'column')}>
                                                {
                                                    selectedFields.map((field, i) => {
                                                        return (
                                                            <option value={i} key={i}>
                                                                {field.fieldName}
                                                            </option>
                                                        );
                                                    })
                                                }
                                            </select>
                                            &nbsp;
                                            <select className="form-select" value={filter.filterType} onChange={e => onChangeFilters(index, e, 'filterType')}>
                                                {
                                                    Object.values(FilterType).map((filter, i) => {
                                                        return (
                                                            <option value={filter} key={i}>
                                                                {filter}
                                                            </option>
                                                        );
                                                    })
                                                }
                                            </select>
                                            &nbsp;
                                            <input
                                                type="text"
                                                value={filter.filterValue}
                                                className="form-control"
                                                aria-label="Text input with dropdown button"
                                                onChange={e => onChangeFilters(index, e, 'filterValue')}
                                            />
                                            &nbsp;
                                            <Button variant="danger" onClick={e => removeFilter(index)}>Remove</Button>
                                        </div>
                                    );
                                })
                            }
                            <Button onClick={() => addFilter()} variant="secondary">Add filter</Button>
                            <br />
                            <br />
                            <Button onClick={() => clearFilters()} variant="secondary">Clear filters</Button>
                        </div>
                    )
                    : (
                        <>
                            <br />
                            <br />
                        </>
                    )
            }
            <Table striped bordered hover>
                <thead>
                    <tr>
                        {activeTable.fields.map((field, i) => {
                            let headerLabel = `${field.fieldName} `;
                            switch (field.fieldType) {
                                case 'S':
                                    headerLabel += '(String)';
                                    break;
                                case 'B':
                                    headerLabel += '(Byte)';
                                    break;
                                case 'W':
                                case 'U':
                                    headerLabel += '(Number)';
                                    break;
                                case 'T':
                                    headerLabel += '(Date/Time)';
                                    break;
                                case 'E':
                                    headerLabel += '(Date/Time)';
                                    break;
                                case 'M':
                                    headerLabel += '(Time)';
                                    break;
                                default:
                                    break;
                            }
                            return (
                                <th
                                    key={i}
                                    onClick={setSort.bind(this, i)}
                                >
                                    {headerLabel}
                                    &nbsp;&nbsp;
                                    {getSortIcon(i)}
                                </th>
                            );
                        })}
                        {
                            allowEdit && <th />
                        }
                    </tr>
                </thead>
                <tbody>
                    {activeTable.pageData.map((row, i) => {
                        return (
                            <tr key={i}>
                                {row.fields.map((field, j) => {
                                    let fieldValue = field;
                                    switch (activeTable.fields[j].fieldType) {
                                        case 'E':
                                            fieldValue = new Date(fieldValue * 1000)
                                                .toLocaleString();
                                            break;
                                        case 'M':
                                            {
                                                const remainder = Number(fieldValue) % 60;
                                                const hours = (Number(fieldValue) - remainder) / 60;
                                                const minutes = remainder;
                                                const t = new Date();
                                                t.setHours(hours);
                                                t.setMinutes(minutes);
                                                t.setSeconds(0);
                                                fieldValue = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                            }
                                            break;
                                        default:

                                            break;
                                    }
                                    return (
                                        <td key={j}>{fieldValue}</td>
                                    );
                                })}
                                {
                                    allowEdit
                                    && (
                                        <td>
                                            <ButtonGroup>
                                                <Button variant="primary" size="sm" onClick={e => showEdit(row.index, e)}>Edit</Button>
                                                <Button variant="danger" size="sm" onClick={e => deleteRow(row.index, e)}>Delete</Button>
                                            </ButtonGroup>
                                        </td>
                                    )
                                }
                            </tr>
                        );
                    })}
                </tbody>
            </Table>
        </div>
    );
};

function fetchTables(type) {
    return fetch(`${API_URL_BASE}/tables_api.html?action=get&type=${type}`)
        .then((response) => {
            return response.text();
        })
        .then((result) => {
            let activeTable;
            const tables = [];
            const lines = result.split('\r\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === '') {
                    continue;
                }
                const headerParts = lines[i].split('|');
                const fields = [];
                for (let j = 3; j < headerParts.length; j++) {
                    if (headerParts[j].trim() === '') {
                        continue;
                    }
                    const fieldMeta = headerParts[j].split(',');
                    const fieldName = fieldMeta[0];
                    const fieldType = fieldMeta[1];
                    const fieldP1 = fieldMeta[2];
                    const fieldP2 = fieldMeta[3];
                    const fieldKey = fieldMeta[4];
                    const fieldRomAddress = fieldMeta[5];
                    const fieldDefault = fieldMeta[6];
                    fields.push({
                        fieldName,
                        fieldType,
                        fieldP1,
                        fieldP2,
                        fieldKey,
                        fieldRomAddress,
                        fieldDefault,
                    });
                }
                const table = {
                    name: headerParts[0],
                    fields,
                    allFields: fields,
                    page: 0,
                    count: headerParts[2],
                    pageData: [],
                    sortDirection: 0,
                    sortField: 0,
                    data: [],
                };
                tables.push(table);
            }
            if (tables.length > 0) {
                activeTable = tables[0];
            }
            return { activeTable, tables };
        })
        .catch((e) => {
            console.log(e);
            // alert('could not get device tables');
        });
}

function fetchData(activeTable) {
    return fetch(`${API_URL_BASE}/tables_api.html?action=rows&table=${activeTable.name}`)
        .then((response) => {
            return response.text();
        })
        .then((result) => {
            const data = [];
            const lines = result.split('\r\n');
            for (let i = 0; i < lines.length; i++) {
                if (i === 0) {
                    activeTable.count = Number(lines[i]);
                    continue;
                }
                if (lines[i].trim() === '') continue;
                const fields = lines[i].split(',');
                const row = {
                    index: fields[0],
                    fields: [],
                };
                for (let j = 1; j < fields.length; j++) {
                    row.fields.push(fields[j]);
                }
                data.push(row);
            }
            const sortField = activeTable.sortField;
            data.sort((a, b) => {
                let aa = a;
                let bb = b;
                if (activeTable.sortDirection === 1) {
                    aa = b;
                    bb = a;
                }
                if (aa.fields[sortField] > bb.fields[sortField]) {
                    return 1;
                }
                if (aa.fields[sortField] < bb.fields[sortField]) {
                    return -1;
                }
                return 0;
            });
            activeTable.data = data;
            activeTable.fullData = data;
            activeTable.page = 0;
            const pageData = [];
            for (let i = 0; i < ROWS_PER_PAGE; i++) {
                if (activeTable.data[i] === undefined) {
                    break;
                }
                pageData.push(activeTable.data[i]);
            }
            activeTable.pageData = pageData;
            const selectedFields = activeTable.fields.map((field) => {
                return {
                    ...field,
                    selected: true,
                };
            });
            return { activeTable, selectedFields };
        })
        .catch((e) => {

        });
}

function fetchLogData(activeTable) {
    return fetchData(activeTable).then((result) => {
        const { activeTable } = result;
        const fields = [{
            fieldName: 'TS',
            fieldType: 'E',
        }];
        const fieldsHashmap = {
            TS: 0,
        };
        // first get total actual table schema
        for (let i = 0; i < activeTable.data.length; i++) {
            activeTable.data[i].fields[1] = activeTable.data[i].fields[1].split(/[=;]+/);
            for (let j = 0; j < activeTable.data[i].fields[1].length - 1; j += 2) {
                const columnName = activeTable.data[i].fields[1][j];
                if (!Object.prototype.hasOwnProperty.call(fieldsHashmap, columnName)) {
                    fieldsHashmap[columnName] = fields.length;
                    fields.push({
                        fieldName: columnName,
                        fieldType: 'none',
                    });
                }
            }
        }
        activeTable.fields = fields;
        activeTable.allFields = fields;
        const selectedFields = fields.map((field) => {
            return {
                ...field,
                selected: true,
            };
        });
        const newData = [];
        // then populate table with values
        for (let i = 0; i < activeTable.data.length; i++) {
            newData.push({
                index: (i + 1).toString(),
                fields: new Array(fields.length).fill(null),
            });
            newData[i].fields[0] = activeTable.data[i].fields[0];
            for (let j = 1; j < activeTable.data[i].fields[1].length - 1; j += 2) {
                const key = activeTable.data[i].fields[1][j - 1];
                const value = activeTable.data[i].fields[1][j];
                newData[i].fields[fieldsHashmap[key]] = value;
            }
        }
        activeTable.data = newData;
        activeTable.fullData = newData;
        const newPageData = [];
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            const formattedRow = newData[i];
            if (formattedRow === undefined) {
                break;
            }
            newPageData.push(formattedRow);
        }
        activeTable.pageData = newPageData;
        return { activeTable, selectedFields };
    });
}

export const Database = () => {
    return (
        <WrappedDatabase fetchData={fetchData} allowEdit tableType="table" label="Database" />
    );
};
export const Log = () => {
    return (
        <WrappedDatabase fetchData={fetchLogData} allowEdit={false} tableType="log" label="Log" />
    );
};

class WrappedDatabase extends React.Component {
    constructor(props) {
        super(props);
        this.fileImport = React.createRef();
        this.tableType = 'table';

        this.state = {
            tables: [],
            activeTable: undefined,
            showEditModal: false,
            rowId: undefined,
            editRow: {},
            showImport: false,
            importRows: [],
            selectedFields: [],
            filters: [],
            snackbarOn: false,
        };

        this.saveRow = this.saveRow.bind(this);
        this.cancelImport = this.cancelImport.bind(this);
        this.hideImport = this.hideImport.bind(this);
        this.hideAdd = this.hideAdd.bind(this);
        this.import = this.import.bind(this);
        this.changePage = this.changePage.bind(this);
        this.changeTable = this.changeTable.bind(this);
        this.fieldValueChanged = this.fieldValueChanged.bind(this);
        this.showEdit = this.showEdit.bind(this);
        this.export = this.export.bind(this);
        this.setSort = this.setSort.bind(this);
        this.getSortIcon = this.getSortIcon.bind(this);
        this.deleteRow = this.deleteRow.bind(this);
        this.import = this.import.bind(this);
        this.toggleSelectedField = this.toggleSelectedField.bind(this);
        this.applyFilters = this.applyFilters.bind(this);
        this.addFilter = this.addFilter.bind(this);
        this.removeFilter = this.removeFilter.bind(this);
        this.onChangeFilters = this.onChangeFilters.bind(this);
        this.selectUnselectAll = this.selectUnselectAll.bind(this);
        this.clearFilters = this.clearFilters.bind(this);
        this.clearTable = this.clearTable.bind(this);
        this.setSnackbarOn = this.setSnackbarOn.bind(this);
    }


    componentDidMount() {
        this.fetchTables();
    }

    onChangeFilters(index, event, element) {
        clearTimeout(filterDebounce);
        const { filters } = this.state;
        filters[index][element] = event.target.value;
        this.setState({
            filters,
        }, () => {
            filterDebounce = setTimeout(() => {
                this.applyFilters();
            }, debounceTimeout);
        });
    }

    setSnackbarOn(value) {
        const { snackbarOn } = this.state;
        const newSnackbarOn = value;
        this.setState({
            snackbarOn: newSnackbarOn,
        });
    }

    getSortIcon(fieldIndex) {
        if (fieldIndex === this.state.activeTable.sortField) {
            if (this.state.activeTable.sortDirection === 0) {
                return <>&uarr;</>;
            }
            return <>&darr;</>;
        }
        return <></>;
    }

    setSort(sortField) {
        const { activeTable } = this.state;
        const data = activeTable.data;
        if (sortField === activeTable.sortField) {
            if (activeTable.sortDirection === 0) {
                activeTable.sortDirection = 1;
            } else {
                activeTable.sortDirection = 0;
            }
        } else {
            activeTable.sortField = sortField;
            activeTable.sortDirection = 0;
        }
        data.sort((a, b) => {
            let aa = a;
            let bb = b;
            if (activeTable.sortDirection === 1) {
                aa = b;
                bb = a;
            }
            if (aa.fields[sortField] > bb.fields[sortField]) {
                return 1;
            }
            if (aa.fields[sortField] < bb.fields[sortField]) {
                return -1;
            }
            return 0;
        });
        activeTable.data = data;
        activeTable.page = 0;
        const pageData = [];
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            if (activeTable.data[i] === undefined) {
                break;
            }
            pageData.push(activeTable.data[i]);
        }
        activeTable.pageData = pageData;
        this.setState({
            activeTable,
        });
    }

    toggleSelectedField(index) {
        clearTimeout(filterDebounce);
        const { selectedFields } = this.state;
        const prevSelected = selectedFields[index].selected;
        selectedFields[index] = {
            ...selectedFields[index],
            selected: !prevSelected,
        };
        this.setState({
            selectedFields,
        }, () => {
            filterDebounce = setTimeout(() => {
                this.applyFilters();
            }, debounceTimeout);
        });
    }

    selectUnselectAll() {
        clearTimeout(filterDebounce);
        const { selectedFields } = this.state;
        let selected = true;
        if (selectedFields.filter(field => field.selected === true).length
            > selectedFields.length / 2) {
            selected = false;
        }
        for (let i = 0; i < selectedFields.length; i++) {
            selectedFields[i].selected = selected;
        }
        this.setState({
            selectedFields,
        }, () => {
            filterDebounce = setTimeout(() => {
                this.applyFilters();
            }, debounceTimeout);
        });
    }

    addFilter() {
        const { filters } = this.state;
        const newFilter = {
            column: 0,
            filterType: FilterType.Contains,
            filterValue: '',
        };
        filters.push(newFilter);
        this.setState({
            filters,
        });
    }

    clearFilters() {
        const { selectedFields, activeTable } = this.state;
        activeTable.data = activeTable.fullData;
        activeTable.count = activeTable.data.length;
        activeTable.fields = activeTable.allFields;
        const newSelectedFields = selectedFields.map((selectedField) => {
            return { ...selectedField, selected: true };
        });
        this.setState({
            activeTable,
            filters: [],
            selectedFields: newSelectedFields,
        }, () => {
            this.changePage(0);
            this.applyFilters();
        });
    }


    removeFilter(index) {
        clearTimeout(filterDebounce);
        const { filters } = this.state;
        filters.splice(index, 1);
        this.setState({
            filters,
        }, () => {
            filterDebounce = setTimeout(() => {
                this.applyFilters();
            }, debounceTimeout);
        });
    }


    handleCloseSnackBar() {
        this.setSnackbarOn(false);
    }

    clearTable() {
        if (window.confirm(`Clear table ${this.state.activeTable.name}?`)) {
            const params = `action=clear&table=${this.state.activeTable.name}`;
            fetch(`${API_URL_BASE}/tables_api.html?${params}`)
                .then((response) => {
                    return response.text();
                })
                .then((result) => {
                    if (result.trim() !== '') alert(result);
                    this.setSnackbarOn(true);
                    this.fetchData();
                })
                .catch((e) => {
                });
        }
    }

    applyFilters() {
        const { selectedFields, activeTable, filters } = this.state;
        const includedColumnIndices = [];
        const newIncludedColumnIndices = {};
        for (let i = 0; i < selectedFields.length; i++) {
            if (selectedFields[i].selected) {
                includedColumnIndices.push(i);
            }
        }
        const newFields = selectedFields.filter(field => field.selected === true);
        let newData = [];
        // apply column filter
        for (let i = 0; i < activeTable.fullData.length; i++) {
            const row = [];
            for (let j = 0; j < includedColumnIndices.length; j++) {
                row.push(activeTable.fullData[i].fields[includedColumnIndices[j]]);
                if (!Object.prototype.hasOwnProperty
                    .call(newIncludedColumnIndices, includedColumnIndices[j])) {
                    newIncludedColumnIndices[includedColumnIndices[j]] = row.length - 1;
                }
            }
            //  start from column 0
            if (row.some(el => el !== null)) {
                newData.push({
                    index: (i + 1).toString(),
                    fields: row,
                });
            }
        }
        // apply filters by value
        activeTable.data = newData;
        newData = [];
        for (let i = 0; i < activeTable.data.length; i++) {
            let filteredIn = true;
            const row = activeTable.data[i].fields;
            for (let j = 0; j < filters.length; j++) {
                const { column, filterType, filterValue } = filters[j];
                const adjColumn = newIncludedColumnIndices[column];
                switch (filterType) {
                    case FilterType.Contains:
                        filteredIn = row[adjColumn] !== null && typeof row[adjColumn] !== 'undefined' && row[adjColumn].includes(filterValue);
                        break;
                    case FilterType.Equals:
                        filteredIn = row[adjColumn] === filterValue.toString();
                        break;
                    case FilterType.IsGreaterThan:
                        filteredIn = row[adjColumn] > Number(filterValue);
                        break;
                    case FilterType.IsLessThan:
                        filteredIn = row[adjColumn] < Number(filterValue);
                        break;
                    case FilterType.IsEmpty:
                        filteredIn = row[adjColumn] === null || row[adjColumn] === '' || typeof row[adjColumn] === 'undefined';
                        break;
                    case FilterType.IsNonEmpty:
                        filteredIn = row[adjColumn] !== null && row[adjColumn] !== '' && typeof row[adjColumn] !== 'undefined';
                        break;
                    default:
                        break;
                }
                if (!filteredIn) break;
            }
            if (filteredIn) {
                newData.push({
                    index: (i + 1).toString(),
                    fields: row,
                });
            }
        }
        activeTable.data = newData;
        activeTable.count = newData.length;
        activeTable.fields = newFields;
        const pageData = [];
        for (let i = 0; i < ROWS_PER_PAGE; i++) {
            if (activeTable.data[i] === undefined) {
                break;
            }
            pageData.push(activeTable.data[i]);
        }
        activeTable.pageData = pageData;
        this.setState({
            activeTable,
        }, () => {
            this.changePage(0);
        });
    }

    changePage(page) {
        if (page < 0) {
            return;
        }
        const remainder = this.state.activeTable.count % ROWS_PER_PAGE;
        const pages = (this.state.activeTable.count - remainder)
            / ROWS_PER_PAGE + (remainder > 0 ? 1 : 0);
        const { activeTable } = this.state;
        // if (page >= pages) {
        //     if (activeTable.data.length === 0) {
        //         activeTable.pageData = [];
        //         this.setState(
        //             activeTable,
        //         );
        //     }
        //     return;
        // }
        activeTable.page = page;
        const pageData = [];
        for (let i = ROWS_PER_PAGE * page; i < ROWS_PER_PAGE * (page + 1); i++) {
            if (activeTable.data[i] === undefined) {
                break;
            }
            pageData.push(activeTable.data[i]);
        }
        activeTable.pageData = pageData;
        this.setState(
            activeTable,
        );
    }

    changeTable(table) {
        table.data = [];
        table.pageData = [];
        table.count = 0;
        table.page = 0;
        this.setState({
            activeTable: table,
        }, () => {
            this.fetchData();
        });
    }

    fetchTables() {
        fetchTables(this.props.tableType).then((result) => {
            const { activeTable, tables } = result;
            this.setState({
                tables,
                activeTable,
            }, () => {
                if (activeTable !== undefined) {
                    this.fetchData();
                }
            });
        });
    }


    fetchData() {
        this.props.fetchData(this.state.activeTable).then((result) => {
            const { activeTable, selectedFields } = result;
            activeTable.sortDirection = 0;
            this.setState({
                activeTable,
                selectedFields,
            }, () => {
                this.getSortIcon(0);
                this.setSort(0);
            });
        });
    }

    hideAdd() {
        this.setState({
            showEditModal: false,
        });
    }

    showEdit(rowId, event) {
        const editRow = {};
        if (rowId === undefined) {
            for (let i = 0; i < this.state.activeTable.fields.length; i++) {
                const field = this.state.activeTable.fields[i];
                editRow[field.fieldName] = this.state.activeTable.fields[i].fieldDefault;
            }
        } else {
            for (let j = 0; j < this.state.activeTable.pageData.length; j++) {
                if (this.state.activeTable.pageData[j].index === rowId) {
                    for (let i = 0; i < this.state.activeTable.fields.length; i++) {
                        const field = this.state.activeTable.fields[i];
                        editRow[field.fieldName] = this.state.activeTable.pageData[j].fields[i];
                    }
                    break;
                }
            }
        }
        this.setState({
            rowId,
            showEditModal: true,
            editRow,
        });
    }

    hideImport() {
        this.setState({
            showImport: false,
        });
    }

    cancelImport() {
        this.setState({
            showImport: false,
            importRows: [],
        });
    }

    fieldValueChanged(event, fieldName) {
        const { editRow } = this.state;
        editRow[fieldName] = event.target.value;
        this.setState({
            editRow,
        });
    }

    saveRow() {
        let rowStr = '';
        const editRow = this.state.editRow;
        for (let i = 0; i < this.state.activeTable.fields.length; i++) {
            rowStr += editRow[this.state.activeTable.fields[i].fieldName];
            if (i < this.state.activeTable.fields.length) {
                rowStr += ',';
            }
        }
        let body = `action=add&row=${rowStr}&table=${this.state.activeTable.name}`;
        if (this.state.rowId !== undefined) {
            body = `action=edit&row=${rowStr}&table=${this.state.activeTable.name}&index=${this.state.rowId}`;
        }
        fetch(`${API_URL_BASE}/tables_api.html`,
            {
                method: 'POST',
                body,
            })
            .then((response) => {
                return response.text();
            })
            .then((result) => {
                if (result.trim() !== '') {
                    alert(result);
                } else {
                    this.setState({
                        showEditModal: false,
                    });
                    this.fetchData();
                }
            })
            .catch((e) => {

            });
    }

    deleteRow(tableRow) {
        const row = this.state.activeTable.page * ROWS_PER_PAGE + Number(tableRow);
        if (window.confirm('Delete this row?')) {
            if (Number.isNaN(row)) {
                return;
            }
            fetch(`${API_URL_BASE}/tables_api.html`,
                {
                    method: 'POST',
                    body: `action=delete&row=${row}&table=${this.state.activeTable.name}`,
                })
                .then((response) => {
                    return response.text();
                })
                .then((result) => {
                    if (result.trim() !== '') {
                        alert(result);
                    } else {
                        this.fetchData();
                    }
                })
                .catch((e) => {

                });
        }
    }

    export() {
        if (!window.confirm('Export current table?')) {
            return;
        }

        const data = JSON.stringify(this.state.activeTable.data);
        const filename = `${this.state.activeTable.name}.json`;

        const file = new Blob([data], { type: 'application/json' });
        if (window.navigator.msSaveOrOpenBlob) {
            // IE10+
            window.navigator.msSaveOrOpenBlob(file, filename);
        } else { // Others
            const a = document.createElement('a');
            const url = URL.createObjectURL(file);
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }, 0);
        }
    }

    import(event) {
        const file = document.getElementById('fileImport').files[0];
        if (!file) {
            alert('no file selected');
            return;
        }
        const reader = new FileReader();
        this.setState({
            showImport: true,
        });
        reader.onload = (e) => {
            const contents = e.target.result;
            const activeTable = this.state.activeTable;
            const importRows = JSON.parse(contents);
            for (let i = 0; i < importRows.length; i++) {
                importRows[i].loaded = false;
            }
            this.setState({
                importRows,
            }, this.importRow);
        };

        reader.readAsText(file);
    }

    importRow() {
        if (this.state.importRows.length > 0) {
            let editRow;
            let rowStr = '';
            for (let i = 0; i < this.state.importRows.length; i++) {
                if (!this.state.importRows[i].loaded) {
                    editRow = this.state.importRows[i];
                    break;
                }
            }
            if (editRow === undefined) {
                this.setState({
                    showImport: false,
                });
                this.fetchData();
                return;
            }
            for (let i = 0; i < editRow.fields.length; i++) {
                rowStr += editRow.fields[i];
                if (i < editRow.fields.length) {
                    rowStr += ',';
                }
            }
            const body = `action=add&row=${rowStr}&table=${this.state.activeTable.name}`;
            fetch(`${API_URL_BASE}/tables_api.html`,
                {
                    method: 'POST',
                    body,
                })
                .then((response) => {
                    return response.text();
                })
                .then((result) => {
                    const importRows = this.state.importRows;
                    for (let i = 0; i < importRows.length; i++) {
                        if (!importRows[i].loaded) {
                            importRows[i].loaded = true;
                            this.setState({
                                importRows,
                            }, this.importRow);
                            break;
                        }
                    }
                })
                .catch((e) => {

                });
        }
    }

    render() {
        return (
            <div>
                <h2>{this.props.label}</h2>
                <Row id="main">
                    <Col md={2}>
                        <ListGroup>
                            <TablesSidebar
                                tables={this.state.tables}
                                activeTable={this.state.activeTable}
                                changeTable={this.changeTable}
                            />
                        </ListGroup>
                    </Col>
                    <Col md={10}>
                        <Form id="content">
                            <RenderedTable
                                activeTable={this.state.activeTable}
                                changeTable={this.changeTable}
                                showEdit={this.showEdit}
                                exportTable={this.export}
                                setSort={this.setSort}
                                getSortIcon={this.getSortIcon}
                                deleteRow={this.deleteRow}
                                fileImport={this.fileImport}
                                importTable={this.import}
                                selectedFields={this.state.selectedFields}
                                toggleSelectedField={this.toggleSelectedField}
                                applyFilters={this.applyFilters}
                                filters={this.state.filters}
                                addFilter={this.addFilter}
                                removeFilter={this.removeFilter}
                                onChangeFilters={this.onChangeFilters}
                                selectUnselectAll={this.selectUnselectAll}
                                clearFilters={this.clearFilters}
                                allowEdit={this.props.allowEdit}
                                clearTable={this.clearTable}
                            />
                        </Form>
                        <div id="pagination">
                            <PaginationTable
                                activeTable={this.state.activeTable}
                                changePage={this.changePage}
                            />
                        </div>
                    </Col>
                </Row>
                <Modal show={this.state.showEditModal} onHide={this.hideAdd} dialogClassName="modal-1000w">
                    <Modal.Header closeButton>
                        <Modal.Title>Add Entry</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <Form>
                            {this.state.activeTable !== undefined
                                ? this.state.activeTable.fields.map((field, i) => {
                                    return (
                                        <Form.Group key={i}>
                                            <label className="form-label">{field.fieldName}</label>
                                            <FieldInput
                                                field={field}
                                                index={i}
                                                activeTable={this.state.activeTable}
                                                editRow={this.state.editRow}
                                                fieldValueChanged={this.fieldValueChanged}
                                            />
                                        </Form.Group>
                                    );
                                })
                                : null}
                        </Form>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant="primary" onClick={this.saveRow}>
                            Ok
                        </Button>
                        <Button variant="secondary" onClick={this.hideAdd}>
                            Cancel
                        </Button>
                    </Modal.Footer>
                </Modal>
                <Modal show={this.state.showImport} onHide={this.hideImport} dialogClassName="modal-1000w">
                    <Modal.Header closeButton>
                        <Modal.Title>Import</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <ImportProgress importRows={this.state.importRows} />
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant="secondary" onClick={this.cancelImport}>
                            Cancel
                        </Button>
                    </Modal.Footer>
                </Modal>
                <Snackbar
                    open={this.state.snackbarOn}
                    autoHideDuration={3000}
                    onClose={() => this.handleCloseSnackBar()}
                    message="Cleared"
                />
            </div>
        );
    }
}
