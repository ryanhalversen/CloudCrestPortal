// Patch overhead Cases that are missing Epic__c by linking them to their
// project's "Needs Assignment" epic.

List<Case> missing = [
    SELECT Id, Projects__c
    FROM Case
    WHERE Subject IN ('Meetings', 'Project Management', 'Helpdesk')
    AND Epic__c = null
    AND Projects__c != null
];

if (missing.isEmpty()) {
    System.debug('No overhead cases missing Epic__c. Nothing to do.');
    return;
}

Set<Id> projectIds = new Set<Id>();
for (Case c : missing) projectIds.add(c.Projects__c);

Map<Id, Id> epicByProject = new Map<Id, Id>();
for (Sprint_Items__c epic : [
    SELECT Id, Projects_new__c
    FROM Sprint_Items__c
    WHERE Name = 'Needs Assignment'
    AND Projects_new__c IN :projectIds
]) {
    epicByProject.put(epic.Projects_new__c, epic.Id);
}

List<Case> toUpdate = new List<Case>();
for (Case c : missing) {
    Id epicId = epicByProject.get(c.Projects__c);
    if (epicId != null) {
        toUpdate.add(new Case(Id = c.Id, Epic__c = epicId));
    }
}

if (toUpdate.isEmpty()) {
    System.debug('No matching epics found for the missing cases.');
    return;
}

update toUpdate;
System.debug('SUCCESS: Patched Epic__c on ' + toUpdate.size() + ' overhead cases.');
