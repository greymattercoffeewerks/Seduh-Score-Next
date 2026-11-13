// FICTIONAL data only: made-up teams and scores in the door's shape.
export const FICTIONAL_RECORD = {
  country_code: 'XA',
  has_record: true,
  stats: {
    championships: 2,
    entries: 3,
    teams: 2,
    matches_won: 1,
    matches_lost: 1,
    best_finish: {
      team_name: 'Alpha Brew',
      competition: 'btc',
      edition_year: 2025,
      stage_reached: 'semi_final',
      placement: 3,
    },
  },
  championships: [
    {
      competition: 'btc',
      competition_name: 'Fictional Championship 2025',
      edition_year: 2025,
      host_city: 'Testville',
      host_country_code: 'XB',
      supplied_by: 'Fictional Federation',
      provenance: 'organiser_archive',
      teams: [
        {
          team_name: 'Alpha Brew',
          stage_reached: 'semi_final',
          placement: 3,
          provenance: 'organiser_archive',
          rounds: [
            {
              round: 'preliminary',
              r1: 40,
              r2: 33,
              score: 73,
              opponent_team_name: null,
              opponent_score: null,
            },
            {
              round: 'quarter_final',
              r1: null,
              r2: null,
              score: 26,
              opponent_team_name: 'Rival',
              opponent_score: 20,
            },
          ],
        },
      ],
    },
  ],
  teams: [
    { team_name: 'Alpha Brew', years: [2024, 2025], best_stage: 'semi_final', best_placement: 3 },
  ],
};
