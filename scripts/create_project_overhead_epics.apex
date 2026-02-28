// Create "Project Overhead" Sprint_Items__c (Epic) for every In Progress Sprint__c
// - Uses Epic_Type__c = 'Sub-Project' so it appears in the Epic Management Panel
// - Owner matches the project owner
// - Skips any project that already has an epic with that name
// - Re-links existing Meetings / Project Management / Helpdesk Cases to the new epic

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

// Collect project IDs that already have a "Project Overhead" epic
Set<Id> alreadyExists = new Set<Id>();
Map<Id, Id> existingEpicByProject = new Map<Id, Id>(); // projectId -> epicId
for (Sprint_Items__c existing : [
    SELECT Id, Projects_new__c
    FROM Sprint_Items__c
    WHERE Name            = 'Project Overhead'
    AND   Projects_new__c IN :projectIds
]) {
    alreadyExists.add(existing.Projects_new__c);
    existingEpicByProject.put(existing.Projects_new__c, existing.Id);
}

// Insert missing epics
List<Sprint_Items__c> toInsert = new List<Sprint_Items__c>();
for (Sprint__c p : projects) {
    if (!alreadyExists.contains(p.Id)) {
        toInsert.add(new Sprint_Items__c(
            Name                      = 'Project Overhead',
            Projects_new__c           = p.Id,
            Epic_Type__c              = 'Sub-Project',
            CloudCrest_Admin__c       = p.OwnerId
        ));
    }
}

if (!toInsert.isEmpty()) {
    insert toInsert;
    for (Sprint_Items__c epic : toInsert) {
        existingEpicByProject.put(epic.Projects_new__c, epic.Id);
    }
    System.debug('Created ' + toInsert.size() + ' "Project Overhead" epics.');
} else {
    System.debug('All In Progress projects already have a "Project Overhead" epic.');
}

// Re-link overhead Cases (Meetings / Project Management / Helpdesk)
Set<String> overheadSubjects = new Set<String>{ 'Meetings', 'Project Management', 'Helpdesk' };

List<Case> overheadCases = [
    SELECT Id, Subject, Projects__c
    FROM Case
    WHERE Subject    IN :overheadSubjects
    AND   Projects__c IN :projectIds
];

List<Case> toUpdate = new List<Case>();
for (Case c : overheadCases) {
    Id epicId = existingEpicByProject.get(c.Projects__c);
    if (epicId != null) {
        toUpdate.add(new Case(Id = c.Id, Epic__c = epicId));
    }
}

if (!toUpdate.isEmpty()) {
    update toUpdate;
    System.debug('Re-linked ' + toUpdate.size() + ' overhead Cases to "Project Overhead" epic.');
} else {
    System.debug('No overhead Cases found to re-link.');
}

System.debug('Done. Skipped ' + alreadyExists.size() + ' projects that already had the epic.');
