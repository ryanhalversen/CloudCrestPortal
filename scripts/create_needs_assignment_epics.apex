// Create "Needs Assignment" Sprint_Items__c (Epic) for every In Progress Sprint__c
// - Owner matches the project owner
// - Skips any project that already has an epic with that name

List<Sprint__c> projects = [
    SELECT Id, OwnerId
    FROM Sprint__c
    WHERE Status__c = 'In Progress'
];

if (projects.isEmpty()) {
    System.debug('No In Progress projects found. Nothing to do.');
    return;
}

Set<Id> projectIds = new Map<Id, Sprint__c>(projects).keySet();

// Collect project IDs that already have a "Needs Assignment" epic
Set<Id> alreadyExists = new Set<Id>();
for (Sprint_Items__c existing : [
    SELECT Projects_new__c
    FROM Sprint_Items__c
    WHERE Name = 'Needs Assignment'
    AND Projects_new__c IN :projectIds
]) {
    alreadyExists.add(existing.Projects_new__c);
}

List<Sprint_Items__c> toInsert = new List<Sprint_Items__c>();
for (Sprint__c p : projects) {
    if (!alreadyExists.contains(p.Id)) {
        toInsert.add(new Sprint_Items__c(
            Name                = 'Needs Assignment',
            Projects_new__c     = p.Id,
            CloudCrest_Admin__c = p.OwnerId
        ));
    }
}

if (toInsert.isEmpty()) {
    System.debug('All In Progress projects already have a "Needs Assignment" epic. Nothing created.');
    return;
}

insert toInsert;
System.debug('SUCCESS: Created ' + toInsert.size() + ' "Needs Assignment" epics. Skipped ' + alreadyExists.size() + ' that already existed.');
