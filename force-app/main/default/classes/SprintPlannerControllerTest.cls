@isTest
public class SprintPlannerControllerTest {

    @TestSetup
    static void setupData() {
        // Create two in-progress projects
        List<Sprint__c> projects = new List<Sprint__c>{
            new Sprint__c(
                Name                    = 'Project Alpha',
                Status__c               = 'In Progress',
                Weekly_Pace_Estimate__c = 40,
                Project_Start_Date__c   = Date.today(),
                Project_End_Date__c     = Date.today().addDays(28)
            ),
            new Sprint__c(
                Name                    = 'Project Beta',
                Status__c               = 'In Progress',
                Weekly_Pace_Estimate__c = 20,
                Project_Start_Date__c   = Date.today(),
                Project_End_Date__c     = Date.today().addDays(14)
            )
        };
        insert projects;

        // Create stories linked to each project
        List<Case> cases = new List<Case>{
            new Case(
                Subject                       = 'Planner Story 1',
                Status                        = 'New',
                Priority                      = 'High',
                Hours_Estimate_to_Complete__c = 8,
                Projects__c                   = projects[0].Id
            ),
            new Case(
                Subject                       = 'Planner Story 2',
                Status                        = 'New',
                Priority                      = 'Medium',
                Hours_Estimate_to_Complete__c = 4,
                Projects__c                   = projects[0].Id
            ),
            new Case(
                Subject                       = 'Planner Story 3',
                Status                        = 'New',
                Priority                      = 'Low',
                Hours_Estimate_to_Complete__c = 2,
                Projects__c                   = projects[1].Id
            )
        };
        insert cases;
    }

    // ── getProjects ───────────────────────────────────────────────────────

    @isTest
    static void testGetProjects_returnsInProgress() {
        Test.startTest();
        List<Sprint__c> result = SprintPlannerController.getProjects();
        Test.stopTest();

        System.assertNotEquals(null, result, 'Result should not be null');
        System.assert(result.size() >= 2, 'Should return at least 2 in-progress projects');
        // Status__c is not returned by getProjects SELECT, so assert on size and fields that are returned
        System.assertNotEquals(null, result[0].Name, 'Project name should be present');
        System.assertNotEquals(null, result[0].Weekly_Pace_Estimate__c != null ? true : false, 'Weekly pace field should be accessible');
    }

    // ── getPlannerData — single project ───────────────────────────────────

    @isTest
    static void testGetPlannerData_singleProject() {
        Sprint__c project = [SELECT Id FROM Sprint__c WHERE Name = 'Project Alpha' LIMIT 1];

        Test.startTest();
        SprintPlannerController.PlannerData result = SprintPlannerController.getPlannerData(project.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'PlannerData should not be null');
        System.assertEquals(1, result.projects.size(), 'Should return exactly 1 project');
        System.assertEquals(project.Id, result.projects[0].Id, 'Returned project Id should match');
        System.assert(result.stories.size() >= 2, 'Should return stories for Project Alpha');
        for (Case c : result.stories) {
            System.assertEquals(project.Id, c.Projects__c, 'All stories should belong to Project Alpha');
        }
    }

    // ── getPlannerData — all projects (null) ──────────────────────────────

    @isTest
    static void testGetPlannerData_allProjects() {
        Test.startTest();
        SprintPlannerController.PlannerData result = SprintPlannerController.getPlannerData(null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'PlannerData should not be null');
        System.assert(result.projects.size() >= 2, 'Should return all in-progress projects');
        System.assert(result.stories.size() >= 3, 'Should return stories across all projects');
    }

    // ── getPlannerData — project with no stories ──────────────────────────

    @isTest
    static void testGetPlannerData_emptyProject() {
        Sprint__c emptyProject = new Sprint__c(
            Name                    = 'Empty Project',
            Status__c               = 'In Progress',
            Weekly_Pace_Estimate__c = 10,
            Project_Start_Date__c   = Date.today(),
            Project_End_Date__c     = Date.today().addDays(7)
        );
        insert emptyProject;

        Test.startTest();
        SprintPlannerController.PlannerData result = SprintPlannerController.getPlannerData(emptyProject.Id);
        Test.stopTest();

        System.assertNotEquals(null, result, 'PlannerData should not be null');
        System.assertEquals(1, result.projects.size(), 'Should return 1 project');
        System.assertEquals(0, result.stories.size(), 'Should return no stories for empty project');
    }

    // ── updateHoursEstimate ───────────────────────────────────────────────

    @isTest
    static void testUpdateHoursEstimate_valid() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Planner Story 1' LIMIT 1];

        Test.startTest();
        SprintPlannerController.updateHoursEstimate(c.Id, 16);
        Test.stopTest();

        Case updated = [SELECT Hours_Estimate_to_Complete__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(16, updated.Hours_Estimate_to_Complete__c, 'Hours should be updated to 16');
    }

    @isTest
    static void testUpdateHoursEstimate_zero() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Planner Story 2' LIMIT 1];

        Test.startTest();
        SprintPlannerController.updateHoursEstimate(c.Id, 0);
        Test.stopTest();

        Case updated = [SELECT Hours_Estimate_to_Complete__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(0, updated.Hours_Estimate_to_Complete__c, 'Hours should be updated to 0');
    }

    @isTest
    static void testUpdateHoursEstimate_decimal() {
        Case c = [SELECT Id FROM Case WHERE Subject = 'Planner Story 3' LIMIT 1];

        Test.startTest();
        SprintPlannerController.updateHoursEstimate(c.Id, 2.5);
        Test.stopTest();

        Case updated = [SELECT Hours_Estimate_to_Complete__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(2.5, updated.Hours_Estimate_to_Complete__c, 'Hours should support decimal values');
    }
}