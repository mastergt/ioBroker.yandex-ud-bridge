'use strict';

// ioBroker enum membership can point to a device, channel, or state.
// Compare on object-ID boundaries, never with a bare string prefix.
function objectBelongsToEnum(stateId, memberId) {
    return typeof stateId === 'string' && typeof memberId === 'string' &&
        (stateId === memberId || stateId.startsWith(`${memberId}.`));
}

function localizedName(name, id) {
    if (typeof name === 'string' && name.trim()) return name.trim();
    if (name && typeof name === 'object') {
        for (const language of ['ru', 'en', 'de']) {
            if (typeof name[language] === 'string' && name[language].trim()) return name[language].trim();
        }
        const first = Object.values(name).find(v => typeof v === 'string' && v.trim());
        if (first) return first.trim();
    }
    return id.split('.').at(-1);
}

function simplifyEnums(objects, prefix) {
    return Object.entries(objects || {})
        .filter(([id, obj]) => id.startsWith(prefix + '.') && obj?.type === 'enum')
        .map(([id, obj]) => ({
            id,
            name: localizedName(obj.common?.name, id),
            members: [...new Set((Array.isArray(obj.common?.members) ? obj.common.members : [])
                .filter(x => typeof x === 'string' && x.trim()))]
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function matchingEnums(stateId, enums) {
    return (enums || []).filter(item => Array.isArray(item.members) &&
        item.members.some(member => objectBelongsToEnum(stateId, member)));
}

module.exports = { objectBelongsToEnum, localizedName, simplifyEnums, matchingEnums };
