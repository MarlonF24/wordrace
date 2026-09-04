import datetime
import enum
import uuid

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Computed, DateTime, Enum, ForeignKeyConstraint, Integer, PrimaryKeyConstraint, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass


class GameMode(str, enum.Enum):
    NORMAL = 'normal'
    COLLIDE = 'collide'


class Games(Base):
    __tablename__ = 'games'
    __table_args__ = (
        CheckConstraint("lexical_fields <> '{}'::jsonb", name='at_least_one_lexical_field'),
        CheckConstraint('start_word <> target_word', name='unique_start_target'),
        PrimaryKeyConstraint('id', name='games_pkey'),
        {'schema': 'public'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'))
    start_word: Mapped[str] = mapped_column(Text, nullable=False)
    target_word: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[GameMode] = mapped_column(Enum(GameMode, values_callable=lambda cls: [member.value for member in cls], name='game_mode'), nullable=False, server_default=text("'normal'::game_mode"))
    lemmatise: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('true'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))
    exclusive_entry_lexical_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    exclusive_sense_lexical_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    shared_lexical_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    entry_lexical_fields: Mapped[dict] = mapped_column(JSONB, Computed('((exclusive_entry_lexical_fields || exclusive_sense_lexical_fields) || shared_lexical_fields)', persisted=True), nullable=False)
    sense_lexical_fields: Mapped[dict] = mapped_column(JSONB, Computed('(exclusive_sense_lexical_fields || shared_lexical_fields)', persisted=True), nullable=False)
    lexical_fields: Mapped[dict] = mapped_column(JSONB, Computed('((exclusive_entry_lexical_fields || exclusive_sense_lexical_fields) || shared_lexical_fields)', persisted=True), nullable=False)
    ai_hints_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    available_pos: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text('\'{"X": true, "ADJ": true, "ADP": true, "ADV": true, "AUX": true, "DET": true, "NUM": true, "SYM": true, "INTJ": true, "NOUN": true, "PART": true, "PRON": true, "VERB": true, "CCONJ": true, "PROPN": true, "PUNCT": true, "SCONJ": true, "SPACE": true}\'::jsonb'))

    game_player_link: Mapped[list['GamePlayerLink']] = relationship('GamePlayerLink', back_populates='game')


class Players(Base):
    __tablename__ = 'players'
    __table_args__ = (
        PrimaryKeyConstraint('id', name='players_pkey'),
        {'schema': 'public'}
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, server_default=text('gen_random_uuid()'))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(True), nullable=False, server_default=text('now()'))

    game_player_link: Mapped[list['GamePlayerLink']] = relationship('GamePlayerLink', back_populates='player')


class GamePlayerLink(Base):
    __tablename__ = 'game_player_link'
    __table_args__ = (
        ForeignKeyConstraint(['game_id'], ['public.games.id'], name='game_player_link_game_id_games_id_fkey'),
        ForeignKeyConstraint(['player_id'], ['public.players.id'], name='game_player_link_player_id_players_id_fkey'),
        PrimaryKeyConstraint('game_id', 'player_id', name='game_player_link_pkey'),
        {'schema': 'public'}
    )

    game_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    player_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    admin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text('false'))
    start_links: Mapped[dict] = mapped_column(JSONB, nullable=False)
    target_links: Mapped[dict] = mapped_column(JSONB, nullable=False)
    found: Mapped[bool] = mapped_column(Boolean, Computed("(((start_links -> '-1'::integer) ->> 'word'::text) = ((target_links -> '-1'::integer) ->> 'word'::text))", persisted=True), nullable=False)
    link_count: Mapped[int] = mapped_column(Integer, Computed('(((jsonb_array_length(start_links) - 1) + jsonb_array_length(target_links)) - 1)', persisted=True), nullable=False)
    duration_ms: Mapped[int] = mapped_column(BigInteger, Computed("GREATEST(((((start_links -> '-1'::integer) ->> 'timestamp'::text))::bigint - (((start_links -> 0) ->> 'timestamp'::text))::bigint), ((((target_links -> '-1'::integer) ->> 'timestamp'::text))::bigint - (((target_links -> 0) ->> 'timestamp'::text))::bigint))", persisted=True), nullable=False)

    game: Mapped['Games'] = relationship('Games', back_populates='game_player_link')
    player: Mapped['Players'] = relationship('Players', back_populates='game_player_link')
