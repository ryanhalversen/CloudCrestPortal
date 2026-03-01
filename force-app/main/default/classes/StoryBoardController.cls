public without sharing class StoryBoardController {

    @AuraEnabled(cacheable=true)
    public static List<Case> getStories(Boolean mineOnly, Id projectId, Id epicId) {
        String q =
            'SELECT Id, CaseNumber, Subject, Status, Priority, Type, Department__c, ' +
            'CreatedDate, Description, Sprint_Week__c, Sprint_Start_Date__c, Projects__c, ' +
            'Hours_Estimate_to_Complete__c, Actual_Hours_to_Complete__c, OwnerId, Owner.Name, Projects__r.Name, Epic__c, Epic__r.Name, ' +
            'ContactId, Contact.Name, Story_Support__c, Story_Support__r.Name, Support_Message_Pending__c, ' +
            'Solution__c, Components_to_Deploy__c, Q_A__c, Documentation__c, Closing_Comments__c ' +
            'FROM Case';

        List<String> filters = new List<String>{
            'Subject NOT IN (\'Meetings\', \'Project Management\', \'Helpdesk\')'
        };
        if (mineOnly) {
            filters.add('OwnerId = \'' + UserInfo.getUserId() + '\'');
        }
        if (projectId != null) {
            filters.add('Projects__c = \'' + projectId + '\'');
        }
        if (epicId != null) {
            filters.add('Epic__c = \'' + epicId + '\'');
        }
        if (!filters.isEmpty()) {
            q += ' WHERE ' + String.join(filters, ' AND ');
        }
        q += ' ORDER BY CreatedDate DESC LIMIT 500';

        return Database.query(q);
    }

    // ── Get Projects ──────────────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Sprint__c> getProjects() {
        return [
            SELECT Id, Name, OwnerId, Owner.Name,
                   Project_Lead_Sprint__c, Project_Lead_Sprint__r.Name
            FROM Sprint__c
            WHERE Status__c = 'In Progress'
            ORDER BY Name ASC
            LIMIT 100
        ];
    }

    // ── Assign Epic ───────────────────────────────────────────────────────
    @AuraEnabled
    public static void assignEpic(Id caseId, Id epicId) {
        try {
            update new Case(Id = caseId, Epic__c = epicId);
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Assign to Sprint ──────────────────────────────────────────────────
    @AuraEnabled
    public static void assignToSprint(Id caseId, Integer sprintWeek, Date sprintStartDate) {
        try {
            Case c = new Case(
                Id                   = caseId,
                Sprint_Week__c       = sprintWeek,
                Sprint_Start_Date__c = sprintStartDate
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Remove from Sprint ────────────────────────────────────────────────
    @AuraEnabled
    public static void removeFromSprint(Id caseId) {
        try {
            Case c = new Case(
                Id                   = caseId,
                Sprint_Week__c       = null,
                Sprint_Start_Date__c = null
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Story Status ───────────────────────────────────────────────
    @AuraEnabled
    public static void updateStoryStatus(Id caseId, String newStatus) {
        try {
            Set<String> validStatuses = new Set<String>{
                'New', 'Scheduled', 'Work In Progress (WIP)', 'Waiting for User',
                'On Hold', 'Backlog', 'In Review', 'In UAT',
                'Blocked', 'Cancelled', 'Completed'
            };
            if (!validStatuses.contains(newStatus)) {
                throw new AuraHandledException('Invalid status value: ' + newStatus);
            }
            Case c = new Case(
                Id     = caseId,
                Status = newStatus
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Priority ───────────────────────────────────────────────────
    @AuraEnabled
    public static void updatePriority(Id caseId, String priority) {
        try {
            Set<String> validPriorities = new Set<String>{
                'Critical', 'High', 'Medium', 'Low'
            };
            if (!validPriorities.contains(priority)) {
                throw new AuraHandledException('Invalid priority value: ' + priority);
            }
            Case c = new Case(
                Id       = caseId,
                Priority = priority
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Next Steps (CaseComment) ──────────────────────────────────────────
    @AuraEnabled
    public static List<CaseComment> getNextSteps(Id caseId) {
        return [
            SELECT Id, CommentBody, CreatedDate, CreatedBy.Name
            FROM CaseComment
            WHERE ParentId = :caseId
            ORDER BY CreatedDate ASC
            LIMIT 200
        ];
    }

    @AuraEnabled
    public static Id addNextStep(Id caseId, String note) {
        CaseComment cc = new CaseComment(
            ParentId    = caseId,
            CommentBody = note,
            IsPublished = false
        );
        insert cc;
        return cc.Id;
    }

    @AuraEnabled
    public static void updateNextStep(Id commentId, String note) {
        try {
            CaseComment cc = new CaseComment(
                Id          = commentId,
                CommentBody = note
            );
            update cc;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Get Time Entries ──────────────────────────────────────────────────
    @AuraEnabled
    public static List<Time__c> getTimeEntries(Id caseId) {
        return [
            SELECT Id, Minutes_Logged__c, Additional_Comments__c,
                   Logged_Date__c, CreatedBy.Name
            FROM Time__c
            WHERE Case__c = :caseId
            ORDER BY Logged_Date__c DESC, CreatedDate DESC
            LIMIT 100
        ];
    }

    // ── Update Time Entry ─────────────────────────────────────────────────
    @AuraEnabled
    public static void updateTimeEntry(Id timeId, Decimal hours, String description) {
        try {
            update new Time__c(
                Id                     = timeId,
                Minutes_Logged__c      = hours * 60,
                Additional_Comments__c = description
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Estimated Hours ────────────────────────────────────────────
    @AuraEnabled
    public static void updateEstimatedHours(Id caseId, Decimal hours) {
        try {
            Case c = new Case(
                Id                            = caseId,
                Hours_Estimate_to_Complete__c = hours
            );
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Log Time ──────────────────────────────────────────────────────────
    @AuraEnabled
    public static Id logTime(Id caseId, Decimal hours, String description, Date loggedDate) {
        try {
            Case c = [SELECT Epic__c FROM Case WHERE Id = :caseId LIMIT 1];
            Time__c t = new Time__c(
                Case__c                = caseId,
                Epic__c                = c.Epic__c,
                Minutes_Logged__c      = hours * 60,
                Additional_Comments__c = description,
                Logged_Date__c         = loggedDate != null ? loggedDate : Date.today()
            );
            insert t;
            return t.Id;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Close Story (Completed / Cancelled) ──────────────────────────────
    @AuraEnabled
    public static void closeStory(Id caseId, String newStatus, String closingComments, String department, String priority, String type) {
        try {
            Set<String> validStatuses = new Set<String>{ 'Completed', 'Cancelled' };
            if (!validStatuses.contains(newStatus)) {
                throw new AuraHandledException('Invalid status: ' + newStatus);
            }
            Set<String> validPriorities = new Set<String>{ 'Critical', 'High', 'Medium', 'Low' };
            if (!validPriorities.contains(priority)) {
                throw new AuraHandledException('Invalid priority: ' + priority);
            }
            update new Case(
                Id                  = caseId,
                Status              = newStatus,
                Closing_Comments__c = closingComments,
                Department__c       = department,
                Priority            = priority,
                Type                = type
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Story Text Fields ──────────────────────────────────────────
    @AuraEnabled
    public static void updateStoryTextFields(Id caseId, String solution, String componentsToDeploy, String qa, String documentation) {
        try {
            update new Case(
                Id                      = caseId,
                Solution__c             = solution,
                Components_to_Deploy__c = componentsToDeploy,
                Q_A__c                  = qa,
                Documentation__c        = documentation
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Update Subject / Description ──────────────────────────────────────
    @AuraEnabled
    public static void updateSubjectDescription(Id caseId, String subject, String description) {
        try {
            update new Case(
                Id          = caseId,
                Subject     = subject,
                Description = description
            );
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Get Contacts for Project Account ─────────────────────────────────
    @AuraEnabled
    public static List<Contact> getContactsForProject(Id projectId) {
        List<Sprint__c> projects = [SELECT Accountlu__c FROM Sprint__c WHERE Id = :projectId LIMIT 1];
        if (projects.isEmpty() || projects[0].Accountlu__c == null) return new List<Contact>();
        Id accountId = projects[0].Accountlu__c;
        return [
            SELECT Id, Name, Title
            FROM Contact
            WHERE AccountId = :accountId
            ORDER BY Name ASC
            LIMIT 50
        ];
    }

    // ── Assign Contact to Story ───────────────────────────────────────────
    @AuraEnabled
    public static void assignContact(Id caseId, Id contactId) {
        try {
            update new Case(Id = caseId, ContactId = contactId);
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Search Users ──────────────────────────────────────────────────────
    @AuraEnabled
    public static List<User> searchUsers(String searchTerm) {
        String term = '%' + String.escapeSingleQuotes(searchTerm) + '%';
        return [
            SELECT Id, Name
            FROM User
            WHERE IsActive = true AND Name LIKE :term
            ORDER BY Name ASC
            LIMIT 10
        ];
    }

    // ── Support Chat (Chatter FeedItem) ──────────────────────────────────
    @AuraEnabled
    public static List<FeedItem> getChatMessages(Id caseId) {
        return [
            SELECT Id, Body, CreatedDate, CreatedById, CreatedBy.Name
            FROM FeedItem
            WHERE ParentId = :caseId
            AND Type = 'TextPost'
            ORDER BY CreatedDate ASC
            LIMIT 100
        ];
    }

    @AuraEnabled
    public static Id postChatMessage(Id caseId, String message) {
        try {
            FeedItem fi = new FeedItem(
                ParentId = caseId,
                Body     = message,
                Type     = 'TextPost'
            );
            insert fi;
            // Flag pending if the poster is the support user, clear it otherwise
            Case c = [SELECT Story_Support__c FROM Case WHERE Id = :caseId LIMIT 1];
            Boolean isSupport = c.Story_Support__c != null &&
                                c.Story_Support__c == UserInfo.getUserId();
            update new Case(Id = caseId, Support_Message_Pending__c = isSupport);
            return fi.Id;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Assign Story Support ──────────────────────────────────────────────
    @AuraEnabled
    public static void assignStorySupport(Id caseId, Id userId) {
        try {
            update new Case(Id = caseId, Story_Support__c = userId);
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Reassign Story ────────────────────────────────────────────────────
    @AuraEnabled
    public static void reassignStory(Id caseId, Id newOwnerId) {
        try {
            Database.DMLOptions dlo = new Database.DMLOptions();
            dlo.assignmentRuleHeader.useDefaultRule = false;
            Case c = new Case(Id = caseId, OwnerId = newOwnerId);
            c.setOptions(dlo);
            update c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }

    // ── Create Story ──────────────────────────────────────────────────────
    @AuraEnabled
    public static void createStory(Id projectId, String subject, String description, String priority, String department, Id epicId) {
        try {
            Id assignEpicId = epicId;
            if (assignEpicId == null) {
                List<Sprint_Items__c> defaultEpics = [
                    SELECT Id
                    FROM Sprint_Items__c
                    WHERE Name = 'Needs Assignment'
                    AND Projects_new__c = :projectId
                    LIMIT 1
                ];
                assignEpicId = defaultEpics.isEmpty() ? null : defaultEpics[0].Id;
            }

            Case c = new Case(
                Subject       = subject,
                Description   = description,
                Priority      = priority,
                Department__c = department,
                Projects__c   = projectId,
                Epic__c       = assignEpicId,
                OwnerId       = UserInfo.getUserId()
            );
            // Disable assignment rules so the case stays owned by the creating user
            Database.DMLOptions dlo = new Database.DMLOptions();
            dlo.assignmentRuleHeader.useDefaultRule = false;
            c.setOptions(dlo);
            insert c;
        } catch (DmlException ex) {
            throw new AuraHandledException(ex.getDmlMessage(0));
        } catch (Exception ex) {
            throw new AuraHandledException(ex.getMessage());
        }
    }
}